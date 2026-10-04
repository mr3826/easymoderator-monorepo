'use strict';

const crypto = require('crypto');
const asyncHandler = require('../../utils/async-middleware-handler');
const { AppError, sendSuccess } = require('../../utils/AppError');
const orderService = require('../order/order.service');
const { Op } = require('sequelize');

let AuditLog = null;
let Order = null;
let DeliveryTracking = null;
try {
    const entities = require('../entities');
    AuditLog = entities.AuditLog;
    Order = entities.Order;
    DeliveryTracking = entities.DeliveryTracking;
} catch (_) {}

let redisClient = null;
try {
    const { getRedisClient } = require('../../utils/redis-client');
    redisClient = getRedisClient();
} catch (_) {}

const MAX_PAGE_SIZE = 50;
const PROBLEM_STATUSES = [
    'cancelled',
    'returned',
    'failed_delivery',
    'failed',
    'damaged',
    'lost',
    'hold',
    'delayed',
    'courier_setup_required',
    'dispatch_indeterminate',
];

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

/**
 * POST /api/mobile/orders/:orderId/book-courier
 * Books courier for an order using orderService.bookForOrder with Redis idempotency lock.
 */
const bookCourier = asyncHandler(async (req, res) => {
    const orderId = orderIdFrom(req);
    const shopId = req.shop.id;
    const userId = req.user.userId || req.user.id;
    const provider = req.body?.provider ? String(req.body.provider).trim().toLowerCase() : null;
    const idempotencyKey = String(req.headers?.['x-idempotency-key'] || req.body?.idempotencyKey || '').trim();

    if (!Order) {
        throw new AppError('Order database entity unavailable', 500, 'INTERNAL_ERROR');
    }

    const order = await Order.findOne({ where: { id: orderId, shop_id: shopId } });
    if (!order) {
        throw new AppError('Order not found', 404, 'NOT_FOUND');
    }

    // Check Redis idempotency lock
    if (idempotencyKey && redisClient) {
        const lockKey = `mobile:courier:book:${shopId}:${orderId}:${idempotencyKey}`;
        const acquired = await redisClient.set(lockKey, '1', 'NX', 'EX', 60).catch(() => null);
        if (!acquired) {
            if (order.delivery_consignment_id || order.delivery_tracking_code) {
                return sendSuccess(res, {
                    tracking_id: order.delivery_tracking_code || order.delivery_consignment_id,
                    consignment_id: order.delivery_consignment_id,
                    provider: order.delivery_provider || provider,
                    booked_at: order.delivery_dispatched_at || new Date().toISOString(),
                    status: order.delivery_status || 'booked',
                    idempotencyReplay: true,
                });
            }
        }
    }

    const overrides = {
        recipient_name: req.body?.recipient_name,
        recipient_phone: req.body?.recipient_phone,
        recipient_address: req.body?.recipient_address,
        item_weight: req.body?.item_weight ?? req.body?.weight_kg,
        item_description: req.body?.item_description,
        delivery_type: req.body?.delivery_type,
        item_type: req.body?.item_type,
        note: req.body?.note,
    };

    const result = await orderService.bookForOrder(order, {
        shopId,
        provider: provider || null,
        requireAiDefault: !provider,
        trigger: 'MANUAL',
        overrides,
    });

    if (result?.blocked && result.status === 'courier_setup_required') {
        return res.status(409).json({
            success: false,
            error: {
                code: 'COURIER_SETUP_REQUIRED',
                message: 'Courier setup is required before booking this order',
                missing: result.missing || [],
                provider: result.provider || provider || null,
            },
        });
    }

    if (result?.blocked && result.status === 'confidence_hold') {
        return res.status(409).json({
            success: false,
            error: {
                code: result.engine_failure ? 'ORDER_CONFIDENCE_UNAVAILABLE' : 'ORDER_CONFIDENCE_HOLD',
                message: result.engine_failure
                    ? 'Order checks are temporarily unavailable. Try again shortly.'
                    : 'This order needs verification before a courier can be booked',
                decision: result.decision,
                reasons: result.reasons || [],
                decision_version: result.decision_version,
            },
        });
    }

    if (result?.blocked) {
        return res.status(409).json({
            success: false,
            error: {
                code: 'COURIER_DISPATCH_INDETERMINATE',
                message: 'Courier booking needs reconciliation before it can be retried',
                provider: result.provider || provider || null,
            },
        });
    }

    if (result?.failed) {
        return res.status(502).json({
            success: false,
            error: {
                code: 'COURIER_BOOKING_FAILED',
                message: result.reason || 'Courier booking failed',
            },
        });
    }

    const bookingData = {
        tracking_id: result.tracking_code || result.consignment_id,
        consignment_id: result.consignment_id,
        provider: result.provider || provider,
        booked_at: new Date().toISOString(),
        status: result.status || 'booked',
    };

    if (AuditLog && typeof AuditLog.create === 'function') {
        const auditHash = crypto.createHash('sha256')
            .update(['COURIER_BOOKED', shopId, orderId, userId, idempotencyKey || Date.now()].join('|'))
            .digest('hex');
        await AuditLog.create({
            user_id: userId,
            shop_id: shopId,
            action: 'COURIER_BOOKED',
            resource_type: 'order',
            resource_id: orderId,
            idempotency_key: auditHash,
            metadata: {
                source: 'MOBILE',
                provider: bookingData.provider,
                tracking_id: bookingData.tracking_id,
                consignment_id: bookingData.consignment_id,
            },
        }).catch((err) => console.warn('Mobile courier booking audit log failed:', err.message));
    }

    sendSuccess(res, bookingData);
});

/**
 * GET /api/mobile/courier/problems
 * Returns parcels experiencing delivery problems or stuck states.
 */
const getProblemParcels = asyncHandler(async (req, res) => {
    const shopId = req.shop.id;
    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 25, MAX_PAGE_SIZE);

    if (!Order) {
        throw new AppError('Order database entity unavailable', 500, 'INTERNAL_ERROR');
    }

    const where = { shop_id: shopId };
    if (req.query.status) {
        where.delivery_status = String(req.query.status).trim();
    } else {
        where.delivery_status = { [Op.in]: PROBLEM_STATUSES };
    }
    if (req.query.provider) {
        where.delivery_provider = String(req.query.provider).trim().toLowerCase();
    }

    const { count, rows } = await Order.findAndCountAll({
        where,
        attributes: [
            'id',
            'order_number',
            'customer_name',
            'customer_phone',
            'total_amount',
            'delivery_provider',
            'delivery_consignment_id',
            'delivery_tracking_code',
            'delivery_status',
            'order_status',
            'delivery_address',
            'delivery_notes',
            'created_at',
            'updated_at',
        ],
        order: [['updated_at', 'DESC']],
        limit,
        offset: (page - 1) * limit,
    });

    const parcels = rows.map((row) => ({
        order_id: row.id,
        order_number: row.order_number,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        total_amount: Number(row.total_amount) || 0,
        cod_amount: Number(row.total_amount) || 0,
        delivery_provider: row.delivery_provider,
        consignment_id: row.delivery_consignment_id,
        tracking_code: row.delivery_tracking_code,
        delivery_status: row.delivery_status,
        order_status: row.order_status,
        delivery_address: row.delivery_address,
        problem_reason: row.delivery_notes || `Status: ${row.delivery_status}`,
        updated_at: row.updated_at,
    }));

    sendSuccess(res, {
        parcels,
        pagination: {
            page,
            limit,
            total: count,
            hasNextPage: page * limit < count,
        },
    });
});

/**
 * GET /api/mobile/orders/:orderId/tracking
 * Returns the timeline and current tracking info for an order.
 */
const getDeliveryTracking = asyncHandler(async (req, res) => {
    const orderId = orderIdFrom(req);
    const shopId = req.shop.id;

    if (!Order) {
        throw new AppError('Order database entity unavailable', 500, 'INTERNAL_ERROR');
    }

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId },
        attributes: [
            'id',
            'order_number',
            'customer_name',
            'customer_phone',
            'total_amount',
            'delivery_provider',
            'delivery_consignment_id',
            'delivery_tracking_code',
            'delivery_status',
            'order_status',
            'delivery_address',
            'created_at',
            'updated_at',
        ],
    });

    if (!order) {
        throw new AppError('Order not found', 404, 'NOT_FOUND');
    }

    let tracking = null;
    if (DeliveryTracking && typeof DeliveryTracking.findOne === 'function') {
        tracking = await DeliveryTracking.findOne({
            where: { order_id: order.id },
            order: [['created_at', 'DESC']],
        }).catch(() => null);
    }

    const history = (Array.isArray(tracking?.status_history) && tracking.status_history.length > 0)
        ? tracking.status_history
        : [
            {
                status: order.delivery_status || 'booked',
                timestamp: order.updated_at || new Date().toISOString(),
                location: tracking?.location_info?.city || 'Processing center',
                note: 'Current delivery status',
            },
        ];

    sendSuccess(res, {
        order_id: order.id,
        order_number: order.order_number,
        provider: tracking?.provider || order.delivery_provider,
        tracking_number: tracking?.tracking_number || order.delivery_tracking_code || order.delivery_consignment_id,
        consignment_id: order.delivery_consignment_id,
        current_status: tracking?.current_status || order.delivery_status || 'booked',
        estimated_delivery: tracking?.estimated_delivery || null,
        actual_delivery: tracking?.actual_delivery || null,
        location_info: tracking?.location_info || null,
        delivery_agent_info: tracking?.delivery_agent_info || null,
        status_history: history,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        delivery_address: order.delivery_address,
        total_amount: Number(order.total_amount) || 0,
        cod_amount: Number(order.total_amount) || 0,
        cod_derived_note: 'Order-derived expectation. Reconciled cash requires provider settlement.',
    });
});

module.exports = {
    bookCourier,
    getProblemParcels,
    getDeliveryTracking,
};
