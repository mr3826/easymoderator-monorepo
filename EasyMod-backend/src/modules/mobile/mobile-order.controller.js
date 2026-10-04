'use strict';

const crypto = require('crypto');
const asyncHandler = require('../../utils/async-middleware-handler');
const { AppError, sendSuccess } = require('../../utils/AppError');
const orderService = require('../order/order.service');
const { Op } = require('sequelize');

let AuditLog = null;
let Order = null;
let Customer = null;
let CustomerDeliveryStats = null;
try {
    const entities = require('../entities');
    AuditLog = entities.AuditLog;
    Order = entities.Order;
    Customer = entities.Customer;
    CustomerDeliveryStats = entities.CustomerDeliveryStats;
} catch (_) {}

let redisClient = null;
try {
    redisClient = require('../../utils/redis').getClient();
} catch (_) {}

const MAX_PAGE_SIZE = 50;
const ORDER_STATUSES = new Set(['draft', 'confirmed', 'finalized', 'cancelled', 'returned']);
const PAYMENT_STATUSES = new Set(['pending', 'paid', 'failed', 'refunded', 'partial']);
const FULFILLMENT_STATUSES = new Set(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']);

function positiveInteger(value, fallback, maximum) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
}

function orderIdFrom(req) {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId || orderId.length > 100) {
        throw new AppError('Order ID is required', 400, 'VALIDATION_ERROR');
    }
    return orderId;
}

function filtersFrom(req) {
    const filters = {
        page: positiveInteger(req.query.page, 1, 10_000),
        limit: positiveInteger(req.query.limit, 25, MAX_PAGE_SIZE),
    };
    if (req.query.search) filters.search = String(req.query.search).trim().slice(0, 100);
    if (ORDER_STATUSES.has(String(req.query.order_status))) filters.order_status = String(req.query.order_status);
    if (PAYMENT_STATUSES.has(String(req.query.payment_status))) filters.payment_status = String(req.query.payment_status);
    if (FULFILLMENT_STATUSES.has(String(req.query.fulfillment_status))) {
        filters.fulfillment_status = String(req.query.fulfillment_status);
    }
    if (req.query.start_date) filters.start_date = String(req.query.start_date);
    if (req.query.end_date) filters.end_date = String(req.query.end_date);
    return filters;
}

const getOrders = asyncHandler(async (req, res) => {
    const filters = filtersFrom(req);
    const orders = await orderService.listOrders(req.user.userId, req.shop.id, {
        ...filters,
        limit: filters.limit + 1,
    });
    const hasNextPage = orders.length > filters.limit;
    sendSuccess(res, {
        orders: hasNextPage ? orders.slice(0, filters.limit) : orders,
        pagination: {
            page: filters.page,
            limit: filters.limit,
            hasNextPage,
        },
    });
});

const getOrder = asyncHandler(async (req, res) => {
    const order = await orderService.getOrderById(orderIdFrom(req), req.user.userId, req.shop.id);
    sendSuccess(res, order);
});

/**
 * POST /api/mobile/orders/:orderId/confirm
 * Reuses existing orderService.confirmOrder with Redis idempotency lock.
 */
const confirmOrder = asyncHandler(async (req, res) => {
    const orderId = orderIdFrom(req);
    const shopId = req.shop.id;
    const userId = req.user.userId || req.user.id;
    const idempotencyKey = String(req.headers?.['x-idempotency-key'] || req.body?.idempotencyKey || '').trim();

    if (idempotencyKey && redisClient) {
        const lockKey = `mobile:order:confirm:${shopId}:${orderId}:${idempotencyKey}`;
        const acquired = await redisClient.set(lockKey, '1', 'NX', 'EX', 60).catch(() => null);
        if (!acquired) {
            const currentOrder = await orderService.getOrderById(orderId, userId, shopId);
            return sendSuccess(res, { success: true, order: currentOrder, idempotencyReplay: true });
        }
    }

    try {
        await orderService.confirmOrder(orderId, userId, shopId);
    } catch (err) {
        // If already confirmed, treat as idempotent success
        const currentOrder = await orderService.getOrderById(orderId, userId, shopId).catch(() => null);
        if (currentOrder && (currentOrder.order_status === 'confirmed' || currentOrder.order_status === 'finalized')) {
            return sendSuccess(res, { success: true, order: currentOrder, idempotencyReplay: true });
        }
        throw err;
    }

    const order = await orderService.getOrderById(orderId, userId, shopId);

    if (AuditLog && typeof AuditLog.create === 'function') {
        const auditHash = crypto.createHash('sha256')
            .update(['ORDER_CONFIRMED', shopId, orderId, userId, idempotencyKey || Date.now()].join('|'))
            .digest('hex');
        await AuditLog.create({
            user_id: userId,
            shop_id: shopId,
            action: 'ORDER_CONFIRMED',
            resource_type: 'order',
            resource_id: orderId,
            idempotency_key: auditHash,
            metadata: {
                source: 'MOBILE',
                order_number: order.order_number,
                total: order.total,
            },
        }).catch((err) => console.warn('Mobile order confirm audit log failed:', err.message));
    }

    sendSuccess(res, { success: true, order });
});

/**
 * POST /api/mobile/orders/:orderId/cancel
 * Reuses existing orderService.cancelOrder with Redis idempotency lock.
 */
const cancelOrder = asyncHandler(async (req, res) => {
    const orderId = orderIdFrom(req);
    const shopId = req.shop.id;
    const userId = req.user.userId || req.user.id;
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;
    const idempotencyKey = String(req.headers?.['x-idempotency-key'] || req.body?.idempotencyKey || '').trim();

    if (idempotencyKey && redisClient) {
        const lockKey = `mobile:order:cancel:${shopId}:${orderId}:${idempotencyKey}`;
        const acquired = await redisClient.set(lockKey, '1', 'NX', 'EX', 60).catch(() => null);
        if (!acquired) {
            const currentOrder = await orderService.getOrderById(orderId, userId, shopId);
            return sendSuccess(res, { success: true, order: currentOrder, idempotencyReplay: true });
        }
    }

    try {
        await orderService.cancelOrder(userId, shopId, orderId, reason);
    } catch (err) {
        const currentOrder = await orderService.getOrderById(orderId, userId, shopId).catch(() => null);
        if (currentOrder && currentOrder.order_status === 'cancelled') {
            return sendSuccess(res, { success: true, order: currentOrder, idempotencyReplay: true });
        }
        throw err;
    }

    const order = await orderService.getOrderById(orderId, userId, shopId);

    if (AuditLog && typeof AuditLog.create === 'function') {
        const auditHash = crypto.createHash('sha256')
            .update(['ORDER_CANCELLED', shopId, orderId, userId, idempotencyKey || Date.now()].join('|'))
            .digest('hex');
        await AuditLog.create({
            user_id: userId,
            shop_id: shopId,
            action: 'ORDER_CANCELLED',
            resource_type: 'order',
            resource_id: orderId,
            idempotency_key: auditHash,
            metadata: {
                source: 'MOBILE',
                reason,
                order_number: order.order_number,
            },
        }).catch((err) => console.warn('Mobile order cancel audit log failed:', err.message));
    }

    sendSuccess(res, { success: true, order });
});

/**
 * GET /api/mobile/orders/:orderId/customer-risk
 * Returns customer delivery history (delivered, RTO, cancelled, duplicate order within 30 min, risk level).
 */
const getCustomerRiskSummary = asyncHandler(async (req, res) => {
    const orderId = orderIdFrom(req);
    const shopId = req.shop.id;
    const userId = req.user.userId || req.user.id;

    const order = await orderService.getOrderById(orderId, userId, shopId);
    if (!order) {
        throw new AppError('Order not found', 404);
    }

    const customerPhone = order.customer_phone ? String(order.customer_phone).trim() : null;
    let deliveryStats = null;
    if (customerPhone && CustomerDeliveryStats && typeof CustomerDeliveryStats.findOne === 'function') {
        deliveryStats = await CustomerDeliveryStats.findOne({
            where: { shop_id: shopId, phone: customerPhone },
        }).catch(() => null);
    }

    const orConditions = [];
    if (customerPhone) orConditions.push({ customer_phone: customerPhone });
    if (order.customer_id) orConditions.push({ customer_id: order.customer_id });

    let pastOrders = [];
    if (orConditions.length > 0 && Order && typeof Order.findAll === 'function') {
        pastOrders = await Order.findAll({
            where: {
                shop_id: shopId,
                [Op.or]: orConditions,
            },
            attributes: ['id', 'order_number', 'order_status', 'payment_status', 'fulfillment_status', 'total', 'created_at'],
            order: [['created_at', 'DESC']],
            limit: 50,
        }).catch(() => []);
    }

    let deliveredCount = 0;
    let rtoCount = 0;
    let cancelledCount = 0;

    for (const po of pastOrders) {
        const orderStatus = String(po.order_status || '').toLowerCase();
        const fulfillStatus = String(po.fulfillment_status || '').toLowerCase();
        if (fulfillStatus === 'delivered' || orderStatus === 'delivered') {
            deliveredCount++;
        }
        if (fulfillStatus === 'returned' || orderStatus === 'returned') {
            rtoCount++;
        }
        if (orderStatus === 'cancelled') {
            cancelledCount++;
        }
    }

    if (deliveryStats) {
        rtoCount = Math.max(rtoCount, deliveryStats.rto_count || 0);
        const deliveredFromStats = Math.max(0, (deliveryStats.delivery_attempts || 0) - (deliveryStats.rto_count || 0));
        deliveredCount = Math.max(deliveredCount, deliveredFromStats);
    }

    const orderCreatedAt = order.created_at ? new Date(order.created_at).getTime() : Date.now();
    const thirtyMinutesMs = 30 * 60 * 1000;
    const duplicateOrder = pastOrders.find((po) => {
        if (String(po.id) === String(order.id)) return false;
        const diff = Math.abs(new Date(po.created_at).getTime() - orderCreatedAt);
        return diff <= thirtyMinutesMs;
    });

    const hasDuplicateRecentOrder = Boolean(duplicateOrder);
    const recentOrderId = duplicateOrder?.id || null;
    const totalOrders = pastOrders.length;

    let riskLevel = 'low';
    if (hasDuplicateRecentOrder || rtoCount >= 2 || (totalOrders >= 3 && rtoCount / totalOrders >= 0.3)) {
        riskLevel = 'high';
    } else if (rtoCount === 1 || cancelledCount >= 2) {
        riskLevel = 'medium';
    }

    sendSuccess(res, {
        risk: {
            delivered_count: deliveredCount,
            rto_count: rtoCount,
            cancelled_count: cancelledCount,
            total_orders: totalOrders,
            has_duplicate_recent_order: hasDuplicateRecentOrder,
            recent_order_id: recentOrderId,
            risk_level: riskLevel,
        },
    });
});

/**
 * POST /api/mobile/orders/manual
 * Creates an order directly from mobile with validation & HITL guarantee.
 */
const createManualOrder = asyncHandler(async (req, res) => {
    const shopId = req.shop.id;
    const userId = req.user.userId || req.user.id;
    const idempotencyKey = String(req.headers?.['x-idempotency-key'] || req.body?.idempotencyKey || '').trim() || null;

    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
        throw new AppError('At least one item is required to create an order', 400, 'VALIDATION_ERROR');
    }

    const customerPhone = String(req.body?.customer_phone || '').trim();
    if (!customerPhone) {
        throw new AppError('Customer phone number is required', 400, 'VALIDATION_ERROR');
    }

    let customerId = req.body?.customer_id || null;
    let customerName = req.body?.customer_name ? String(req.body.customer_name).trim().slice(0, 100) : null;

    if (!customerId && customerPhone && Customer && typeof Customer.findOne === 'function') {
        const existingCustomer = await Customer.findOne({
            where: { shop_id: shopId, phone: customerPhone },
        }).catch(() => null);
        if (existingCustomer) {
            customerId = existingCustomer.id;
            if (!customerName) customerName = existingCustomer.name;
        }
    }

    const orderPayload = {
        customer_id: customerId,
        customer_name: customerName,
        customer_phone: customerPhone,
        shipping_address: req.body?.delivery_address || req.body?.shipping_address || null,
        channel: 'mobile_manual',
        order_status: req.body?.is_draft ? 'draft' : (req.body?.order_status || 'confirmed'),
        payment_status: req.body?.payment_status || 'pending',
        payment_method: req.body?.payment_method || 'cod',
        items: items.map((it) => ({
            product_id: it.product_id || it.id,
            quantity: positiveInteger(it.quantity, 1, 1000),
            price: Number(it.price || 0),
        })),
        delivery_fee: req.body?.delivery_fee != null ? Number(req.body.delivery_fee) : 0,
        discount: req.body?.discount != null ? Number(req.body.discount) : 0,
        notes: req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null,
    };

    const order = await orderService.createOrder(userId, shopId, orderPayload, idempotencyKey);

    if (AuditLog && typeof AuditLog.create === 'function') {
        const auditHash = crypto.createHash('sha256')
            .update(['ORDER_CREATED', shopId, order.id, userId, idempotencyKey || Date.now()].join('|'))
            .digest('hex');
        await AuditLog.create({
            user_id: userId,
            shop_id: shopId,
            action: 'ORDER_CREATED',
            resource_type: 'order',
            resource_id: order.id,
            idempotency_key: auditHash,
            metadata: {
                source: 'MOBILE',
                order_number: order.order_number,
                total: order.total,
            },
        }).catch((err) => console.warn('Mobile order create audit log failed:', err.message));
    }

    sendSuccess(res, { success: true, order }, 201);
});

module.exports = {
    getOrders,
    getOrder,
    confirmOrder,
    cancelOrder,
    getCustomerRiskSummary,
    createManualOrder,
};
