const { Order, OrderItem, Product, Customer, UserShop, OrderReturn, CourierDispatch } = require('../entities');
const courierDispatchClaims = require('../delivery/courier-dispatch-claim.service');
const { AppError, sanitizeErrorMessage } = require('../../utils/AppError');
const { sequelize } = require('../../utils/database/database-setup');
const { Op } = require('sequelize');
const deliveryService = require('../delivery/delivery.service');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');
const { invalidate: invalidateStock } = require('../product/stock-status-guard.service');
const { findOrderByIdempotencyKey } = require('./order-idempotency.service');

/**
 * Constants for order processing
 */
const DEFAULT_COD_MAX_AMOUNT = 50000; // BDT
const DEFAULT_CURRENCY = 'BDT';
const ORDER_NUMBER_PAD_LENGTH = 6;
const SHOP_PREFIX_LENGTH = 8;
const RTO_RISK_THRESHOLD = 70;

// State machine definitions
const ORDER_STATES = ['draft', 'placed', 'paid', 'fulfilled', 'cancelled', 'refunded'];
const PAYMENT_STATES = ['pending', 'paid', 'unpaid', 'refunded', 'partially_paid'];
const COD_PAYMENT_STATUSES = ['unpaid', 'pending', null, undefined];

const COURIER_SETUP_REQUIRED_STATUS = 'courier_setup_required';
const DISPATCH_INDETERMINATE_STATUS = 'dispatch_indeterminate';
const DISPATCH_NOTIFICATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Verify user has access to shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};

/**
 * Generate next order number (ORD-001, ORD-002...) — P2-4: race-free via sequence table
 * Uses order_sequences table with atomic UPDATE/INSERT + RETURNING (Postgres) or transaction (SQLite).
 */
const generateOrderNumber = async (shopId, transaction = null) => {
    const dialect = sequelize.getDialect();
    const q = transaction ? (sql, opts) => sequelize.query(sql, { ...opts, transaction }) : (sql, opts) => sequelize.query(sql, opts);

    if (dialect === 'postgres') {
        const [rows] = await q(
            `INSERT INTO order_sequences (shop_id, next_number)
             VALUES (:shopId, 1)
             ON CONFLICT (shop_id) DO UPDATE SET next_number = order_sequences.next_number + 1
             RETURNING next_number`,
            { replacements: { shopId } }
        );
        const nextNumber = rows && rows[0] ? rows[0].next_number : 1;
        const shopPrefix = String(shopId).replace(/-/g, '').slice(0, 8).toUpperCase();
        return `ORD-${shopPrefix}-${nextNumber.toString().padStart(6, '0')}`;
    }

    // SQLite: transaction + SELECT then UPDATE
    const t = transaction || await sequelize.transaction();
    try {
        const [existing] = await sequelize.query(
            'SELECT next_number FROM order_sequences WHERE shop_id = ?',
            { replacements: [shopId], transaction: t }
        );
        let nextNumber = 1;
        if (existing && existing.length > 0) {
            nextNumber = existing[0].next_number + 1;
            await sequelize.query(
                'UPDATE order_sequences SET next_number = ? WHERE shop_id = ?',
                { replacements: [nextNumber, shopId], transaction: t }
            );
        } else {
            await sequelize.query(
                'INSERT INTO order_sequences (shop_id, next_number) VALUES (?, 1)',
                { replacements: [shopId], transaction: t }
            );
        }
        if (!transaction) await t.commit();
        const shopPrefix = String(shopId).replace(/-/g, '').slice(0, 8).toUpperCase();
        return `ORD-${shopPrefix}-${nextNumber.toString().padStart(6, '0')}`;
    } catch (err) {
        if (!transaction) await t.rollback();
        throw err;
    }
};

/**
 * Create a new order
 * CRITICAL: Tracks usage for billing on successful creation
 */
/**
 * Check if order is COD (Cash on Delivery)
 */
const isCodOrder = (paymentStatus) => COD_PAYMENT_STATUSES.includes(paymentStatus);

/**
 * Run RTO Shield check for COD orders
 */
const runRtoShieldCheck = async (customerPhone, shopId) => {
    if (!customerPhone) return { blocked: false };

    const RtoShieldService = require('../rto-shield/rto-shield.service');
    const { getNetworkSettings } = require('../rto-shield/rto-network-settings');

    // Honor the shop's network participation: opted-out shops are scored on their own list only.
    let enforceNetwork = true;
    try {
        enforceNetwork = (await getNetworkSettings(shopId)).enforce !== false;
    } catch (_) { /* default to enforcing if settings unavailable */ }

    const result = await RtoShieldService.checkPhone(customerPhone, shopId, { enforceNetwork });

    if (result.flagged && result.risk_score >= RTO_RISK_THRESHOLD) {
        return {
            blocked: true,
            reason: `Order blocked by RTO Shield: ${result.reason} (risk score: ${result.risk_score})`
        };
    }

    // Mid-risk (verify tier): allow the order but tell the caller to confirm before dispatch.
    return { blocked: false, tier: result.tier, requiresVerification: result.tier === 'verify' };
};

/**
 * Validate order items and calculate totals
 */
const validateItemsAndCalculateTotals = async (items, shopId, transaction) => {
    const itemIds = items.map((item) => item.product_id);
    const products = await Product.findAll({
        where: { id: { [Op.in]: itemIds }, shop_id: shopId },
        transaction
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const validItems = [];

    for (const item of items) {
        const product = productMap.get(item.product_id);
        if (!product) {
            throw new AppError(`Product not found: ${item.product_id}`, 404);
        }

        // Verify stock if tracking enabled
        const insufficientStock = product.track_quantity &&
                                 !product.allow_backorder &&
                                 product.quantity < item.quantity;
        if (insufficientStock) {
            throw new AppError(`Insufficient stock for product: ${product.name}`, 400);
        }

        // Use server-side catalog price to prevent client-side price tampering
        const unitPrice = parseFloat(product.price);
        const itemTotal = unitPrice * item.quantity;
        subtotal += itemTotal;

        validItems.push({
            product_id: product.id,
            quantity: item.quantity,
            price: unitPrice,
            total: itemTotal,
            productInstance: product
        });
    }

    return { validItems, subtotal };
};

/**
 * Calculate order totals from subtotal and adjustments
 */
const calculateOrderTotals = (subtotal, discount = 0, tax = 0, deliveryFee = 0) => ({
    subtotal,
    discount: parseFloat(discount || 0),
    tax: parseFloat(tax || 0),
    deliveryFee: parseFloat(deliveryFee || 0),
    total: subtotal - parseFloat(discount || 0) + parseFloat(tax || 0) + parseFloat(deliveryFee || 0)
});

/**
 * Validate COD order doesn't exceed max amount
 */
const validateCodOrderAmount = (total, currency = DEFAULT_CURRENCY) => {
    const codMax = parseInt(process.env.COD_ORDER_MAX_VALUE || String(DEFAULT_COD_MAX_AMOUNT), 10);

    if (total > codMax) {
        throw new AppError(
            `COD orders cannot exceed ${currency} ${codMax.toLocaleString()}. Please use an online payment method for large orders.`,
            422
        );
    }
};

/**
 * Create order items and deduct stock atomically
 */
const createOrderItemsAndDeductStock = async (orderId, validItems, shopId, transaction) => {
    for (const item of validItems) {
        await OrderItem.create({
            order_id: orderId,
            product_id: item.product_id,
            quantity: item.quantity,
            price: item.price,
            total: item.total
        }, { transaction });

        // Atomic stock deduction
        if (item.productInstance.track_quantity) {
            await item.productInstance.decrement('quantity', {
                by: item.quantity,
                transaction
            });
            // Invalidate Redis stock cache after commit (fire-and-forget with retry)
            invalidateStockWithRetry(shopId, item.product_id);
        }
    }
};

/**
 * Invalidate stock cache with basic retry logic
 */
const invalidateStockWithRetry = async (shopId, productId, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await invalidateStock(shopId, productId);
            return;
        } catch (err) {
            if (attempt === maxRetries) {
                console.error(`Failed to invalidate stock cache after ${maxRetries} attempts`, err);
                return;
            }
            // Exponential backoff: 100ms, 200ms, 400ms
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        }
    }
};

/**
 * Enforce state consistency on order
 */
const enforceStateConsistency = async (order) => {
    let needsSave = false;

    if (!PAYMENT_STATES.includes(order.payment_status)) {
        order.payment_status = 'pending';
        needsSave = true;
    }

    if (!ORDER_STATES.includes(order.order_status)) {
        order.order_status = 'draft';
        needsSave = true;
    }

    if (needsSave) {
        await order.save();
    }
};

/**
 * Track order usage after successful creation
 */
const trackOrderUsage = async (order, shopId, requestId, logger) => {
    try {
        const usageResult = await subscriptionService.trackUsage(
            shopId,
            'orders',
            1,
            requestId
        );
        order.usage_transaction_id = usageResult.transactionId;
        await order.save();
    } catch (usageErr) {
        logger.error('Failed to track usage', usageErr);
    }
};

/**
 * Core order creation logic — shared by createOrder (user-auth) and createOrderInternal (chatbot/automated).
 * Refactored for clarity, testability, and maintainability.
 */
const _createOrderCore = async (shopId, orderData, logger, requestId = null) => {
    // USAGE_LIMIT_EXCEEDED check BEFORE creating the DB transaction
    await subscriptionService.checkOrderLimit(shopId);

    // RTO Shield: check phone blacklist for COD orders before opening transaction
    const codOrder = isCodOrder(orderData.payment_status);
    if (codOrder) {
        const rtoCheck = await runRtoShieldCheck(orderData.customer_phone, shopId);
        if (rtoCheck.blocked) {
            throw new AppError(rtoCheck.reason, 422);
        }
        if (rtoCheck.requiresVerification) {
            // Mid-risk COD: allowed through, but flagged so the seller verifies before dispatch.
            logger.warn('RTO Shield: COD order requires manual verification before dispatch', {
                shopId, phone: orderData.customer_phone
            });
        }
    }

    // Idempotency key check
    if (requestId) {
        const existingOrder = await findOrderByIdempotencyKey(shopId, requestId);
        if (existingOrder) return existingOrder;
    }

    const transaction = await sequelize.transaction();

    try {
        // 1. Validate items and calculate subtotal
        const { validItems, subtotal } = await validateItemsAndCalculateTotals(
            orderData.items,
            shopId,
            transaction
        );

        // 2. Calculate order totals
        const totals = calculateOrderTotals(
            subtotal,
            orderData.discount,
            orderData.tax,
            orderData.delivery_fee
        );

        // 3. Validate COD order amount
        if (codOrder) {
            validateCodOrderAmount(totals.total);
        }

        // 4. Generate Order Number
        const orderNumber = await generateOrderNumber(shopId, transaction);

        // Denormalized line-item snapshot for the order's JSON `items` column.
        // The order-detail dialog, the order invoice, and the auto-courier dispatch
        // all read order.items — NOT the order_items association — so without this
        // snapshot they show an empty item list even though the order_items rows and
        // the computed total are correct. (This was the "manual order created but
        // items/info missing" bug: items=[] on the order row.) Both the manual and
        // the chatbot/automated paths flow through here, so one place fixes both.
        // Key aliases: `productName` (FE dialog), `product_name`/`name` (courier + invoice).
        const itemsSnapshot = validItems.map((vi) => {
            const productName = vi.productInstance?.name || null;
            return {
                product_id: vi.product_id,
                productName,
                product_name: productName,
                name: productName,
                quantity: vi.quantity,
                price: vi.price,
                total: vi.total,
            };
        });

        // 5. Create Order
        const order = await Order.create({
            shop_id: shopId,
            customer_id: orderData.customer_id,
            customer_name: orderData.customer_name,
            customer_phone: orderData.customer_phone || null,
            order_number: orderNumber,
            channel: orderData.channel || 'manual',
            order_status: orderData.order_status || 'draft',
            payment_status: orderData.payment_status || 'pending',
            fulfillment_status: orderData.fulfillment_status || 'unfulfilled',
            items: itemsSnapshot,
            subtotal: totals.subtotal,
            discount: totals.discount,
            tax: totals.tax,
            delivery_fee: totals.deliveryFee,
            total: totals.total,
            delivery_address: orderData.delivery_address || null,
            delivery_zone: orderData.delivery_zone || null,
            payment_method: orderData.payment_method || null,
            payment_method_id: orderData.paymentMethodId || orderData.payment_method_id || null,
            note: orderData.note,
            idempotency_key: requestId || null
        }, { transaction });

        // 6. Create Order Items and update stock atomically
        await createOrderItemsAndDeductStock(order.id, validItems, shopId, transaction);

        // 7. Final usage limit check before commit (defense in depth)
        await subscriptionService.checkOrderLimit(shopId);

        await transaction.commit();

        // 8. Track usage after successful commit
        await trackOrderUsage(order, shopId, requestId, logger);
        try {
            require('../analytics/funnel-events.service')
                .recordInternalFunnelEvent({
                    event: 'first_order_captured',
                    shopId,
                    onceKey: shopId,
                    oncePerEntity: true,
                    metadata: {
                        order_id: order.id,
                        channel: order.channel || null,
                        order_status: order.order_status,
                    },
                })
                .catch(() => {});
        } catch (_) { /* funnel logging must never affect committed orders */ }

        // 9. Enforce state consistency
        await enforceStateConsistency(order);

        // 10. Push notification to shop owner (fire-and-forget — never blocks order creation)
        if (process.env.NODE_ENV !== 'test') {
            setImmediate(() => {
                try {
                    const merchantNotificationService = require('../notification/merchant-notification.service');
                    const { NOTIFICATION_EVENTS } = require('../notification/notification-events');
                    merchantNotificationService.notifyShop(
                        shopId,
                        NOTIFICATION_EVENTS.NEW_ORDER,
                        {
                            orderId: order.id,
                            orderNumber: order.order_number,
                            total: order.total,
                            customerName: order.customer_name,
                            channel: order.channel
                        },
                        { dedupeKey: order.id }
                    ).catch(() => {});
                } catch (_) { /* notification failure must never affect order */ }
            });
        }

        return order;
    } catch (err) {
        try { await transaction.rollback(); } catch (_) { /* already committed */ }
        throw err;
    }
};

/**
 * Create order — requires authenticated user (verifies shop access).
 */
const createOrder = async (userId, shopId, orderData, requestId = null) => {
    const logger = createLogger(requestId, shopId, userId);
    await verifyShopAccess(userId, shopId);
    return _createOrderCore(shopId, orderData, logger, requestId);
};

/**
 * Create order from internal/automated flows (chatbot, webhooks) — bypasses user auth.
 * All other guards (subscription limit, RTO Shield, stock, COD cap) still apply.
 */
const createOrderInternal = async (shopId, orderData, requestId = null) => {
    const logger = createLogger(requestId, shopId, null);
    return _createOrderCore(shopId, orderData, logger, requestId);
};

/**
 * Update an order
 * Only allowed when order_status is 'pending' or 'draft'.
 * Records an audit log entry of what changed.
 */
const updateOrder = async (orderId, userId, shopId, updateData) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    // Block edits once order has moved beyond editable states
    const NON_EDITABLE_STATUSES = ['shipped', 'delivered', 'cancelled'];
    if (NON_EDITABLE_STATUSES.includes(order.order_status)) {
        throw new AppError(
            `Cannot edit order with status '${order.order_status}'. Only orders not yet shipped can be edited.`,
            409
        );
    }

    // Allow updating statuses, note, and agent-editable fields
    const allowedUpdates = [
        'order_status', 'payment_status', 'fulfillment_status', 'note',
        'quantity', 'notes', 'delivery_address', 'customer_phone', 'customer_name', 'payment_method'
    ];
    const updates = {};
    const auditChanges = {};

    Object.keys(updateData).forEach(key => {
        if (allowedUpdates.includes(key) && updateData[key] !== undefined) {
            const oldValue = order[key];
            const newValue = updateData[key];
            if (oldValue !== newValue) {
                auditChanges[key] = { from: oldValue, to: newValue };
            }
            updates[key] = newValue;
        }
    });

    if (Object.keys(updates).length === 0) {
        return await getOrderById(orderId, userId, shopId);
    }

    // Persist the changes and append audit trail to metadata
    const existingMeta = order.metadata || {};
    const auditLog = existingMeta.audit_log || [];
    auditLog.push({
        changed_by: userId,
        changed_at: new Date().toISOString(),
        changes: auditChanges
    });
    updates.metadata = { ...existingMeta, audit_log: auditLog };

    await order.update(updates);

    // Restore inventory when an order is cancelled here (the dashboard's Cancel button
    // patches order_status='cancelled' through this path). Mirrors cancelOrder(). The
    // audit guard fires only on a real transition INTO cancelled, so stock is never
    // double-restored. Best-effort — a restore failure must not fail the cancel itself.
    if (auditChanges.order_status && auditChanges.order_status.to === 'cancelled') {
        try {
            await sequelize.transaction(async (transaction) => {
                const items = await OrderItem.findAll({ where: { order_id: orderId }, transaction });
                for (const item of items) {
                    const product = await Product.findOne({ where: { id: item.product_id, shop_id: shopId }, transaction });
                    if (product?.track_quantity) {
                        await product.increment('quantity', { by: item.quantity, transaction });
                        invalidateStockWithRetry(shopId, item.product_id);
                    }
                }
            });
        } catch (restoreErr) {
            console.error('Stock restore on cancel failed:', restoreErr.message);
        }
    }

    // B2: When status changes to 'shipped', send tracking notification
    if (auditChanges.order_status && auditChanges.order_status.to === 'shipped') {
        const orderTrackingService = require('./order-tracking.service');
        const trackingNumber = updateData.tracking_number || null;
        orderTrackingService.sendTrackingNotification(order, shopId, { trackingNumber }).catch(err => {
            console.warn('Tracking notification failed:', err.message);
        });
    }

    return await getOrderById(orderId, userId, shopId);
};

/**
 * Get single order by ID
 */
const getOrderById = async (orderId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId },
        include: [
            {
                model: Customer,
                as: 'customer',
                attributes: ['id', 'name', 'phone']
            },
            {
                model: OrderItem,
                as: 'order_items',
                include: [{
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'image_url', 'price']
                }]
            }
        ]
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    return order;
};

/**
 * List orders with filters
 */
const listOrders = async (userId, shopId, filters = {}) => {
    await verifyShopAccess(userId, shopId);
    const dialect = sequelize.getDialect();
    const likeOp = dialect === 'postgres' ? Op.iLike : Op.like;

    const whereClause = {
        shop_id: shopId
    };

    // Date Range Filter
    if (filters.start_date || filters.end_date) {
        whereClause.created_at = {};
        if (filters.start_date) {
            whereClause.created_at[Op.gte] = filters.start_date;
        }
        if (filters.end_date) {
            whereClause.created_at[Op.lte] = filters.end_date;
        }
    }

    // Status Filters
    if (filters.payment_status) {
        whereClause.payment_status = filters.payment_status;
    }
    if (filters.fulfillment_status) {
        whereClause.fulfillment_status = filters.fulfillment_status;
    }

    // Search Filter (Order Number OR Customer Name OR Customer Phone)
    const includeOptions = [
        {
            model: Customer,
            as: 'customer',
            attributes: ['id', 'name', 'phone']
        },
        {
            model: OrderItem,
            as: 'order_items',
            attributes: ['id', 'quantity', 'total'] // Light include for list
        }
    ];

    if (filters.search) {
        const search = String(filters.search).trim();
        whereClause[Op.or] = [
            { order_number: { [likeOp]: `%${search}%` } },
            { '$customer.name$': { [likeOp]: `%${search}%` } },
            { '$customer.phone$': { [likeOp]: `%${search}%` } }
        ];
    }

    const page = Math.max(1, Number(filters.page || 1));
    const limit = Math.min(100, Math.max(1, Number(filters.limit || 20)));
    const offset = (page - 1) * limit;

    const orders = await Order.findAll({
        where: whereClause,
        include: includeOptions,
        order: [['created_at', 'DESC']],
        limit,
        offset,
        distinct: true
    });

    return orders;
};

/**
 * Delete order
 */
const deleteOrder = async (orderId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    await order.destroy();
    return { message: 'Order deleted successfully' };
};

/**
 * Confirm a draft order (draft -> confirmed)
 */
const confirmOrder = async (orderId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (order.order_status !== 'draft') {
        throw new AppError(`Cannot confirm order with status: ${order.order_status}`, 400);
    }


    // Update status to confirmed
    await order.update({ order_status: 'confirmed' });

    // --- INVOICE CREATION LOGIC ---
    // Create invoice for this order (simple, not subscription-based)
    const { Invoice } = require('../entities');
    const { sendEmail } = require('../../utils/email.service');
    let invoice = null;
    try {
        // Generate invoice number: INV-YYYYMM-ORDERID
        const now = new Date();
        const yearMonth = now.toISOString().substring(0, 7).replace('-', '');
        const invoiceNumber = `INV-${yearMonth}-${order.order_number}`;
        invoice = await Invoice.create({
            shop_id: shopId,
            invoice_number: invoiceNumber,
            amount: order.total,
            status: 'pending',
            billing_period: yearMonth,
            invoice_type: 'Order',
            due_date: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            notes: `Order invoice for ${order.customer_name || 'Customer'}`,
            metadata: {
                orderId: order.id,
                orderNumber: order.order_number,
                customerName: order.customer_name,
                customerPhone: order.customer_phone,
                items: order.items,
                subtotal: order.subtotal,
                tax: order.tax,
                delivery_fee: order.delivery_fee,
                total: order.total
            }
        });
    } catch (err) {
        console.error('Invoice creation failed:', err.message);
    }

    // --- EMAIL LOGIC ---
    try {
        const { orderConfirmationEmail } = require('../../utils/email-templates/order-confirmation');
        let customerEmail = null;
        let customerObj = null;
        if (order.customer_id) {
            customerObj = await Customer.findOne({ where: { id: order.customer_id, shop_id: order.shop_id } });
            if (customerObj?.email) customerEmail = customerObj.email;
        }
        if (!customerEmail && order.customer_email) customerEmail = order.customer_email;

        if (customerEmail) {
            const { subject, html, text } = orderConfirmationEmail(order, customerObj || { name: order.customer_name, phone: order.customer_phone });
            await sendEmail({ to: customerEmail, subject, html, text });
        }
    } catch (err) {
        console.error('Order confirmation email failed:', err.message);
    }
    // Return order (with invoice info if needed)

    // Dispatch through the same canonical path used by manual and AI flows.
    // Courier setup is operational state: it must never undo a confirmed order.
    try {
        await bookForOrder(order, {
            shopId,
            requireAiDefault: true,
            throwOnError: false,
            stepData: {
                name: order.customer_name,
                phone: order.customer_phone,
                address: order.delivery_address,
                notes: order.note || order.notes || null,
            },
        });
    } catch (deliveryError) {
        // Log error but don't fail order confirmation
        console.error('Delivery dispatch failed:', deliveryError.message);
        // Order is still confirmed, just without delivery tracking
    }

    return await getOrderById(order.id, userId, shopId);
};

/**
 * Finalize a confirmed order (confirmed -> finalized)
 * This would be called after payment is processed
 */
const finalizeOrder = async (orderId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (order.order_status !== 'confirmed') {
        throw new AppError(`Cannot finalize order with status: ${order.order_status}`, 400);
    }

    // Update status to finalized
    await order.update({ order_status: 'finalized' });

    return await getOrderById(order.id, userId, shopId);
};

/**
 * V2: Get orders by customer
 */
const getOrdersByCustomer = async (userId, shopId, customerId, options = {}) => {
    await verifyShopAccess(userId, shopId);

    const whereClause = {
        shop_id: shopId,
        customer_id: customerId
    };

    if (options.status && options.status !== 'all') {
        whereClause.order_status = options.status;
    }

    const limit = Number(options.limit || 5);

    const orders = await Order.findAll({
        where: whereClause,
        order: [['created_at', 'DESC']],
        limit
    });

    return orders;
};

/**
 * V2: Cancel order
 */
const cancelOrder = async (userId, shopId, orderId, reason, customerId) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (customerId && String(order.customer_id) !== String(customerId)) {
        throw new AppError('Customer verification failed', 403);
    }

    // Cancelling an already-cancelled order must not run the restore block
    // again: every tracked item would be incremented a second time, inflating
    // stock by the order quantity on each repeat call. updateOrderById guards
    // this by only restoring on a real transition INTO cancelled; this entry
    // point needs the same guard, and a retried request is the normal way to
    // hit it.
    if (order.order_status === 'cancelled') {
        throw new AppError('Order is already cancelled', 400);
    }

    await sequelize.transaction(async (transaction) => {
        await order.update(
            { order_status: 'cancelled', note: reason ? `Cancelled: ${reason}` : order.note },
            { transaction }
        );

        // Restore inventory for tracked products
        const items = await OrderItem.findAll({ where: { order_id: orderId }, transaction });
        for (const item of items) {
            const product = await Product.findOne({ where: { id: item.product_id, shop_id: shopId }, transaction });
            if (product?.track_quantity) {
                await product.increment('quantity', { by: item.quantity, transaction });
                invalidateStockWithRetry(shopId, item.product_id);
            }
        }
    });

    return order;
};

/**
 * V2: Create return request
 */
const createReturnRequest = async (userId, shopId, orderId, payload) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    const request = await OrderReturn.create({
        order_id: orderId,
        customer_id: payload.customer_id,
        reason: payload.reason || null,
        items: payload.items || [],
        description: payload.description || null,
        status: 'pending_approval'
    });

    return request;
};

const tryRequire = (modulePath) => {
    try {
        return require(modulePath);
    } catch (_) {
        return null;
    }
};

const getCourierDispatchModel = () => {
    if (CourierDispatch && typeof CourierDispatch.findOrCreate === 'function') {
        return CourierDispatch;
    }

    const entities = tryRequire('../entities');
    if (entities?.CourierDispatch && typeof entities.CourierDispatch.findOrCreate === 'function') {
        return entities.CourierDispatch;
    }

    return null;
};

const getCourierReadinessService = () => {
    const readiness = tryRequire('../delivery/courier-readiness.service');
    if (!readiness) return null;
    if (typeof readiness.evaluateReadiness === 'function') return readiness;
    if (typeof readiness.getReadiness === 'function') {
        return { ...readiness, evaluateReadiness: readiness.getReadiness };
    }
    return null;
};

const asSafeReason = (value, fallback) => {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    return sanitizeErrorMessage(value.trim()).slice(0, 500);
};

const isDefinitiveProviderRejection = (error) => {
    const status = Number(error?.response?.status ?? error?.status ?? error?.statusCode);
    return Number.isInteger(status)
        && status >= 400
        && status < 500
        && ![408, 409, 429].includes(status);
};

const blockedCourierResolution = (reason, missing = [], extra = {}) => ({
    blocked: true,
    reason: asSafeReason(reason, 'COURIER_SETUP_REQUIRED'),
    missing: Array.isArray(missing) ? missing.filter(item => typeof item === 'string').slice(0, 20) : [],
    ...extra,
});

/**
 * Resolve the courier that is allowed to receive an order.
 *
 * New installations use deliveryService.resolveAiDefaultProvider(), which is
 * the authoritative no-fallback resolver. The getActiveProvider branch is
 * retained only for older test/installation shapes that do not yet expose the
 * readiness service; it never runs once the new resolver is available.
 */
const resolveCourierProvider = async (shopId, { provider = null, requireAiDefault = false } = {}) => {
    const preferredProvider = provider && provider !== 'active' ? String(provider) : null;

    if (!preferredProvider && typeof deliveryService.resolveAiDefaultProvider === 'function') {
        try {
            const resolved = await deliveryService.resolveAiDefaultProvider(shopId);
            if (!resolved || resolved.blocked || !resolved.provider || resolved.provider === 'active') {
                return blockedCourierResolution(
                    resolved?.reason || resolved?.reasonCode || 'AI_DEFAULT_NOT_CONFIGURED',
                    resolved?.missing,
                    { provider: resolved?.provider || null, readiness: resolved?.readiness || null }
                );
            }

            const readiness = resolved.readiness;
            if (readiness && readiness.ready !== true && readiness.status !== 'ACTIVE') {
                return blockedCourierResolution(
                    readiness.error || readiness.reason || readiness.status,
                    readiness.missing,
                    { provider: resolved.provider, readiness }
                );
            }

            return {
                blocked: false,
                provider: String(resolved.provider),
                instance: resolved.instance || null,
                pickup: resolved.pickup || null,
                readiness: readiness || null,
                source: 'ai_default',
            };
        } catch (error) {
            return blockedCourierResolution(
                error?.code || 'COURIER_READINESS_UNAVAILABLE',
                [],
                { provider: null }
            );
        }
    }

    if (preferredProvider) {
        const readinessService = getCourierReadinessService();
        if (readinessService && typeof deliveryService.getProviderInstance === 'function') {
            try {
                const readiness = await readinessService.evaluateReadiness(shopId, preferredProvider);
                if (!readiness || (readiness.ready !== true && readiness.status !== 'ACTIVE')) {
                    return blockedCourierResolution(
                        readiness?.error || readiness?.reason || readiness?.status || 'COURIER_SETUP_REQUIRED',
                        readiness?.missing,
                        { provider: preferredProvider, readiness: readiness || null }
                    );
                }
            } catch (error) {
                return blockedCourierResolution(
                    error?.code || 'COURIER_READINESS_UNAVAILABLE',
                    [],
                    { provider: preferredProvider }
                );
            }
        }

        try {
            const instance = typeof deliveryService.getProviderInstance === 'function'
                ? await deliveryService.getProviderInstance(shopId, preferredProvider)
                : null;
            return {
                blocked: false,
                provider: preferredProvider,
                instance,
                pickup: null,
                source: 'explicit',
            };
        } catch (error) {
            return blockedCourierResolution(
                error?.code || 'COURIER_NOT_CONFIGURED',
                [],
                { provider: preferredProvider }
            );
        }
    }

    // Once the readiness module exists, an absent AI default must not silently
    // fall back to the most recently edited active integration.
    if (requireAiDefault && getCourierReadinessService()) {
        return blockedCourierResolution('AI_DEFAULT_NOT_CONFIGURED', ['ai_default_courier']);
    }

    if (typeof deliveryService.getActiveProvider !== 'function') {
        return blockedCourierResolution('AI_DEFAULT_NOT_CONFIGURED', ['ai_default_courier']);
    }

    try {
        const active = await deliveryService.getActiveProvider(shopId);
        if (!active?.provider || active.provider === 'active') {
            return blockedCourierResolution('AI_DEFAULT_NOT_CONFIGURED', ['ai_default_courier']);
        }
        return {
            blocked: false,
            provider: String(active.provider),
            instance: active.instance || null,
            pickup: active.pickup || null,
            source: 'legacy_active_provider',
        };
    } catch (error) {
        return blockedCourierResolution(error?.code || 'COURIER_PROVIDER_UNAVAILABLE');
    }
};

const normalizeCourierAddress = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized.startsWith('{')) {
            try { return normalizeCourierAddress(JSON.parse(normalized)); } catch (_) { /* plain text */ }
        }
        return normalized;
    }
    if (typeof value !== 'object') return String(value).trim();

    if (typeof value.full_address === 'string' && value.full_address.trim()) {
        return value.full_address.trim();
    }

    const orderedFields = [
        'street_address', 'address', 'road', 'house', 'area', 'upazila',
        'thana', 'district', 'city', 'postal_code'
    ];
    const parts = orderedFields
        .map(key => value[key])
        .filter(part => part !== null && part !== undefined && String(part).trim())
        .map(part => String(part).trim());
    return parts.join(', ');
};

const numericOr = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const orderItemsForCourier = (order) => {
    if (Array.isArray(order?.items)) return order.items;
    if (typeof order?.items === 'string') {
        try {
            const parsed = JSON.parse(order.items);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }
    return [];
};

/**
 * Build the one internal order shape consumed by every courier adapter.
 * Provider-specific aliases are kept only at this boundary for old callers;
 * the registry consumes the canonical fields.
 */
const buildCourierOrderData = (order, { stepData = {}, overrides = {}, pickup = null } = {}) => {
    const stepValues = stepData && typeof stepData === 'object' ? stepData : {};
    const overrideValues = overrides && typeof overrides === 'object' ? overrides : {};
    const orderNumber = order?.order_number || String(order?.id || 'ORDER').slice(0, 8).toUpperCase();
    const customerName = order?.customer_name || stepValues.name || overrideValues.customer_name || overrideValues.recipient_name || 'Customer';
    const rawPhone = order?.customer_phone || stepValues.phone || overrideValues.customer_phone || overrideValues.recipient_phone || '';
    const customerPhone = (() => {
        const formatter = tryRequire('../delivery/bd-phone-validator.service')?.formatForCourier;
        return typeof formatter === 'function' ? formatter(rawPhone) : rawPhone;
    })();
    const address = normalizeCourierAddress(
        order?.delivery_address || stepValues.address || overrideValues.delivery_address || overrideValues.recipient_address
    );
    const total = numericOr(order?.total, 0);
    // Cash-to-collect on delivery must reflect what the customer still owes,
    // not the order's face value. A 'paid' order was already settled online
    // (bKash/Nagad/card) so the courier must collect 0, or every provider
    // re-invoices the customer for the full amount as COD. There is no
    // due-balance/paid-amount field on the Order model today, so
    // 'partially_paid' (and every other non-'paid' status, including an
    // unset payment_status on legacy/manual orders) falls back to the full
    // total exactly like a normal COD order.
    const collectionAmount = order?.payment_status === 'paid' ? 0 : total;
    const items = orderItemsForCourier(order);
    const itemQuantity = items.reduce((sum, item) => {
        const quantity = Number(item?.quantity);
        return sum + (Number.isInteger(quantity) && quantity > 0 ? quantity : 1);
    }, 0) || 1;
    const itemDescription = items
        .map(item => item?.name || item?.product_name || item?.productName)
        .filter(Boolean)
        .join(', ') || overrideValues.item_description || `Order ${orderNumber}`;
    const itemWeight = numericOr(
        overrideValues.item_weight ?? overrideValues.weight_kg ?? stepValues.item_weight,
        0.5
    );
    const deliveryType = overrideValues.delivery_type ?? stepValues.delivery_type ?? 48;
    const orderData = {
        id: order?.id,
        order_number: orderNumber,
        customer_name: customerName,
        customer_phone: customerPhone,
        delivery_address: address,
        total,
        note: order?.note || order?.notes || stepValues.notes || overrideValues.note || '',
        item_quantity: itemQuantity,
        item_weight: itemWeight,
        item_description: itemDescription,
        delivery_type: deliveryType,
        item_type: overrideValues.item_type ?? stepValues.item_type ?? 2,

        // Legacy aliases are harmless to the registry and keep old direct
        // consumers from receiving undefined recipient fields.
        recipient_name: customerName,
        recipient_phone: customerPhone,
        recipient_address: address,
        cod_amount: collectionAmount,
        amount_to_collect: collectionAmount,
        weight: itemWeight,
    };

    const pickupData = pickup && typeof pickup === 'object' ? pickup : {};
    const storeId = pickupData.provider_store_id
        || pickupData.providerStoreId
        || pickupData.store_id
        || pickupData.storeId;
    if (storeId !== undefined && storeId !== null && String(storeId).trim()) {
        orderData.store_id = storeId;
        orderData.pickup_store_id = storeId;
    }

    return orderData;
};

const getCourierNotificationEvent = (eventName) => {
    const notificationEvents = tryRequire('../notification/notification-events');
    return notificationEvents?.NOTIFICATION_EVENTS?.[eventName] || eventName.toLowerCase();
};

const notifyCourierEvent = async (shopId, eventName, payload, dedupeKey) => {
    try {
        const notificationService = tryRequire('../notification/merchant-notification.service');
        if (typeof notificationService?.notifyShop !== 'function') return null;
        return await notificationService.notifyShop(
            shopId,
            getCourierNotificationEvent(eventName),
            payload,
            {
                dedupeKey,
                dedupeTtlSeconds: DISPATCH_NOTIFICATION_TTL_SECONDS,
            }
        );
    } catch (_) {
        return null;
    }
};

const markCourierSetupRequired = async (order, shopId, resolution = {}) => {
    const reason = asSafeReason(
        resolution.reason || resolution.reasonCode,
        'COURIER_SETUP_REQUIRED'
    );
    const missing = Array.isArray(resolution.missing)
        ? resolution.missing.filter(item => typeof item === 'string').slice(0, 20)
        : [];
    const payload = {
        orderId: order?.id || null,
        orderNumber: order?.order_number || null,
        provider: resolution.provider || null,
        reason,
        reasonCode: reason,
        missing,
        status: COURIER_SETUP_REQUIRED_STATUS,
    };

    if (typeof order?.update === 'function' && !order.delivery_consignment_id && !order.delivery_tracking_code) {
        try {
            await order.update({ delivery_status: COURIER_SETUP_REQUIRED_STATUS });
        } catch (_) {
            // The order remains confirmed even if the operational marker fails.
        }
    } else if (typeof Order?.update === 'function' && order?.id) {
        try {
            await Order.update(
                { delivery_status: COURIER_SETUP_REQUIRED_STATUS },
                { where: { id: order.id, shop_id: shopId } }
            );
        } catch (_) {
            // Best effort marker; never turn a confirmed order into a failure.
        }
    }

    await notifyCourierEvent(
        shopId,
        'COURIER_SETUP_REQUIRED',
        payload,
        `${order?.id || order?.order_number || 'order'}:courier_setup_required`
    );

    return {
        blocked: true,
        status: COURIER_SETUP_REQUIRED_STATUS,
        ...payload,
    };
};

const transitionCourierDispatchRecord = async (record, values, options = {}) => courierDispatchClaims.transitionCourierDispatch(
    record,
    values,
    {
        model: options.model || getCourierDispatchModel(),
        ownerToken: options.ownerToken,
        expectedStatus: options.expectedStatus,
    },
);

const markCourierDispatchIndeterminate = async (order, shopId, provider, record, reason, ownerToken) => {
    const safeReason = asSafeReason(reason, 'courier_dispatch_indeterminate');
    let claimTransition;
    try {
        claimTransition = await transitionCourierDispatchRecord(
            record,
            { status: 'INDETERMINATE', error: safeReason },
            { ownerToken, expectedStatus: 'PENDING' },
        );
    } catch (_) {
        return false;
    }
    if (!claimTransition.updated) return false;

    try {
        if (typeof Order?.update === 'function' && order?.id) {
            await Order.update(
                { delivery_status: DISPATCH_INDETERMINATE_STATUS },
                {
                    where: {
                        id: order.id,
                        shop_id: shopId,
                        delivery_consignment_id: null,
                        delivery_tracking_code: null,
                    },
                },
            );
        } else if (typeof order?.update === 'function') {
            await order.update({ delivery_status: DISPATCH_INDETERMINATE_STATUS });
        }
    } catch (_) {
        // Operational status is best effort and must not mask the provider error.
    }

    await notifyCourierEvent(
        shopId,
        'COURIER_BOOKING_FAILED',
        {
            orderId: order?.id || null,
            orderNumber: order?.order_number || null,
            provider: provider || null,
            reason: safeReason,
            error: safeReason,
            status: DISPATCH_INDETERMINATE_STATUS,
        },
        `${order?.id || order?.order_number || 'order'}:dispatch_indeterminate`
    );
    return true;
};

const markCourierDispatchFailed = async (record, reason, ownerToken) => {
    try {
        return await transitionCourierDispatchRecord(
            record,
            {
                status: 'FAILED',
                error: asSafeReason(reason, 'courier_booking_failed'),
            },
            { ownerToken, expectedStatus: 'PENDING' },
        );
    } catch (_) {
        return { updated: false, record };
    }
};

const claimCourierDispatchRecord = async (order, shopId, provider) => {
    const model = getCourierDispatchModel();
    if (!model) return { state: 'unavailable', provider, record: null };

    const { deriveBookCourierIdempotencyKey } = require('../ai/contracts/action.contract');
    const idempotencyKey = deriveBookCourierIdempotencyKey({
        shopId,
        orderId: order.id,
        provider,
    });
    return courierDispatchClaims.claimCourierDispatch({
        model,
        shopId,
        orderId: order.id,
        provider,
        idempotencyKey,
    });
};

const synthesizeCourierResult = (order, provider, record) => ({
    provider: provider || order?.delivery_provider || null,
    consignment_id: record?.consignment_id || order?.delivery_consignment_id || record?.tracking_code || order?.delivery_tracking_code,
    tracking_code: record?.tracking_code || order?.delivery_tracking_code || record?.consignment_id || order?.delivery_consignment_id,
    status: order?.delivery_status || 'booked',
    invoice: order?.order_number || null,
});

const persistDeliveryResult = async (order, deliveryResult) => {
    const trackingNumber = deliveryResult?.tracking_code || deliveryResult?.consignment_id;
    if (!trackingNumber) throw new Error('Courier returned no tracking reference');

    const normalizedResult = {
        ...deliveryResult,
        provider: deliveryResult.provider || order?.delivery_provider,
        consignment_id: deliveryResult.consignment_id || trackingNumber,
        tracking_code: trackingNumber,
        status: deliveryResult.status || 'booked',
    };
    if (!normalizedResult.provider) throw new Error('Courier returned no provider');

    const sessionService = tryRequire('./order-session-standalone.service');
    if (typeof sessionService?.persistDeliveryResult === 'function') {
        return sessionService.persistDeliveryResult(order, normalizedResult);
    }

    if (typeof order?.update === 'function') {
        await order.update({
            delivery_provider: normalizedResult.provider,
            delivery_consignment_id: normalizedResult.consignment_id,
            delivery_tracking_code: normalizedResult.tracking_code,
            delivery_status: normalizedResult.status,
            delivery_dispatched_at: order.delivery_dispatched_at || new Date(),
        });
    }
    return normalizedResult;
};

const normalizeBookForOrderArguments = (orderOrShopId, orderOrOptions, maybeOptions) => {
    if (typeof orderOrShopId === 'string') {
        return {
            shopId: orderOrShopId,
            order: orderOrOptions,
            options: typeof maybeOptions === 'string' ? { provider: maybeOptions } : (maybeOptions || {}),
        };
    }
    if (typeof orderOrOptions === 'string' && maybeOptions && typeof maybeOptions === 'object') {
        return { shopId: orderOrOptions, order: orderOrShopId, options: maybeOptions };
    }
    if (orderOrShopId?.order?.id) {
        const { order, ...envelopeOptions } = orderOrShopId;
        return {
            shopId: envelopeOptions.shopId || order.shop_id,
            order,
            options: { ...envelopeOptions, ...(orderOrOptions || {}) },
        };
    }
    return {
        shopId: orderOrOptions?.shopId || maybeOptions?.shopId || orderOrShopId?.shop_id,
        order: orderOrShopId,
        options: typeof orderOrOptions === 'string' ? { provider: orderOrOptions } : (orderOrOptions || {}),
    };
};

/**
 * Canonical courier booking entry point for all order paths.
 *
 * The helper deliberately keeps merchant/settlement order state separate from
 * delivery state: a missing courier setup or an ambiguous provider response
 * never changes order_status or fulfillment_status.
 */
const bookForOrder = async (orderOrShopId, orderOrOptions, maybeOptions) => {
    const { shopId, order, options: rawOptions } = normalizeBookForOrderArguments(
        orderOrShopId,
        orderOrOptions,
        maybeOptions
    );
    const options = rawOptions || {};

    if (!order?.id || !shopId) {
        throw new AppError('Order and shop are required for courier booking', 400, 'VALIDATION_ERROR');
    }
    if (order.shop_id && String(order.shop_id) !== String(shopId)) {
        throw new AppError('Order does not belong to the selected shop', 403, 'TENANT_MISMATCH');
    }

    if (order.delivery_consignment_id || order.delivery_tracking_code) {
        return synthesizeCourierResult(order, options.provider || order.delivery_provider, options.dispatchRecord);
    }

    const provider = options.provider && options.provider !== 'active' ? String(options.provider) : null;
    const resolution = options.resolvedProvider || await resolveCourierProvider(shopId, {
        provider,
        requireAiDefault: options.requireAiDefault !== false && !provider,
    });
    if (!resolution || resolution.blocked || !resolution.provider || resolution.provider === 'active') {
        return markCourierSetupRequired(order, shopId, resolution || blockedCourierResolution('AI_DEFAULT_NOT_CONFIGURED'));
    }

    const orderData = buildCourierOrderData(order, {
        stepData: options.stepData,
        overrides: options.overrides,
        pickup: resolution.pickup,
    });
    const missingOrderData = [
        ['customer_name', orderData.customer_name],
        ['customer_phone', orderData.customer_phone],
        ['delivery_address', orderData.delivery_address],
    ].filter(([, value]) => !String(value || '').trim()).map(([key]) => key);
    if (missingOrderData.length) {
        return markCourierSetupRequired(order, shopId, {
            provider: resolution.provider,
            reason: 'COURIER_ORDER_DATA_INCOMPLETE',
            missing: missingOrderData,
        });
    }

    const { verifyAuthorization } = require('../ai/action-gate');
    const { deriveBookCourierIdempotencyKey } = require('../ai/contracts/action.contract');
    const idempotencyKey = options.idempotencyKey || deriveBookCourierIdempotencyKey({
        shopId,
        orderId: order.id,
        provider: resolution.provider,
    });
    if (options.requireAuthorization || options.authorization) {
        const authorized = verifyAuthorization(options.authorization, {
            actionType: 'BOOK_COURIER',
            shopId,
            idempotencyKey,
            evidenceSnapshotHash: options.evidenceSnapshotHash,
        });
        if (!authorized) {
            const authorizationError = new Error('Valid BOOK_COURIER authorization is required');
            authorizationError.code = 'BOOK_COURIER_UNAUTHORIZED';
            throw authorizationError;
        }
    }

    let dispatchRecord = null;
    let dispatchOwnerToken = null;
    let providerCallStarted = false;
    let providerCallCompleted = false;
    try {
        const claim = await claimCourierDispatchRecord(order, shopId, resolution.provider);
        dispatchRecord = claim.record;
        dispatchOwnerToken = claim.ownerToken || null;
        if (claim.state === 'unavailable') {
            const claimError = new Error('Courier dispatch claim service is unavailable');
            claimError.code = 'COURIER_DISPATCH_CLAIM_UNAVAILABLE';
            throw claimError;
        }
        if (claim.state === 'committed') {
            // The claim is now scoped to (shop_id, order_id) only, so this
            // branch can be reached by a request for a DIFFERENT provider than
            // the one that actually committed. Report the record's own
            // provider — the courier that really booked the parcel — not the
            // just-attempted resolution.provider, or persistDeliveryResult
            // below would overwrite order.delivery_provider with a courier
            // that never touched this order.
            const committedResult = synthesizeCourierResult(order, dispatchRecord?.provider || resolution.provider, dispatchRecord);
            await persistDeliveryResult(order, committedResult);
            return committedResult;
        }
        if (claim.state === 'existing') {
            return {
                blocked: true,
                status: DISPATCH_INDETERMINATE_STATUS,
                provider: resolution.provider,
                reason: 'existing_courier_dispatch_claim',
            };
        }

        if (!dispatchOwnerToken) {
            const claimError = new Error('Courier dispatch claim owner is missing');
            claimError.code = 'COURIER_DISPATCH_OWNER_MISSING';
            throw claimError;
        }

        if (typeof deliveryService.createDeliveryOrder !== 'function') {
            throw new Error('Courier booking service is unavailable');
        }

        providerCallStarted = true;
        const rawResult = await deliveryService.createDeliveryOrder(
            shopId,
            orderData,
            resolution.provider
        );
        providerCallCompleted = true;
        const result = {
            ...rawResult,
            provider: rawResult?.provider || resolution.provider,
        };
        await persistDeliveryResult(order, result);

        const committed = await transitionCourierDispatchRecord(
            dispatchRecord,
            {
                status: 'COMMITTED',
                consignment_id: result.consignment_id || result.tracking_code || null,
                tracking_code: result.tracking_code || result.consignment_id || null,
                error: null,
            },
            { ownerToken: dispatchOwnerToken, expectedStatus: 'PENDING' },
        );
        if (!committed.updated) {
            const latest = await getCourierDispatchModel()?.findOne?.({
                where: { shop_id: shopId, order_id: order.id, provider: resolution.provider },
            });
            if (String(latest?.status || '').toUpperCase() === 'COMMITTED'
                && (latest.consignment_id || latest.tracking_code) === (result.consignment_id || result.tracking_code)) {
                return result;
            }
            const claimError = new Error('Courier dispatch claim was lost after provider booking');
            claimError.code = 'COURIER_CLAIM_LOST_AFTER_PROVIDER';
            throw claimError;
        }
        return result;
    } catch (error) {
        const definitiveProviderRejection = providerCallStarted
            && !providerCallCompleted
            && isDefinitiveProviderRejection(error);
        if (definitiveProviderRejection) {
            await markCourierDispatchFailed(dispatchRecord, error.message, dispatchOwnerToken);
        } else if (providerCallStarted) {
            await markCourierDispatchIndeterminate(
                order,
                shopId,
                resolution.provider,
                dispatchRecord,
                error.message,
                dispatchOwnerToken,
            );
        }
        if (options.throwOnError === false) {
            return {
                failed: true,
                status: providerCallStarted && !definitiveProviderRejection
                    ? DISPATCH_INDETERMINATE_STATUS
                    : 'dispatch_failed',
                provider: resolution.provider,
                reason: asSafeReason(error.message, 'COURIER_BOOKING_FAILED'),
            };
        }
        throw error;
    }
};

module.exports = {
    createOrder,
    createOrderInternal,
    updateOrder,
    getOrderById,
    listOrders,
    deleteOrder,
    confirmOrder,
    finalizeOrder,
    getOrdersByCustomer,
    cancelOrder,
    createReturnRequest,
    bookForOrder,
    claimCourierDispatchRecord,
    transitionCourierDispatchRecord,
    markCourierDispatchIndeterminate,
    resolveCourierProvider,
    markCourierSetupRequired,
    buildCourierOrderData
};
