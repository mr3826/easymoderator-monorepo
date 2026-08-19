const { Order, OrderItem, Product, Customer, UserShop, OrderReturn } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { sequelize } = require('../../utils/database/database-setup');
const { Op } = require('sequelize');
const deliveryService = require('../delivery/delivery.service');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');
const { invalidate: invalidateStock } = require('../product/stock-status-guard.service');

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
        const existingOrder = await Order.findOne({
            where: { shop_id: shopId, idempotency_key: requestId }
        });
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
                .recordFunnelEvent({
                    event: 'first_order_captured',
                    shopId,
                    onceKey: shopId,
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

    // Attempt to dispatch delivery order if active provider exists
    try {
        const activeProvider = await deliveryService.getActiveProvider(shopId);
        
        if (activeProvider && order.total > 0) {
            // Build delivery order payload from order data
            const deliveryPayload = {
                order_number: order.order_number,
                customer_name: order.customer_name || 'Customer',
                customer_phone: order.customer_phone || '',
                delivery_address: order.delivery_address || '',
                total: parseFloat(order.total),
                note: order.note || '',
                item_quantity: 1, // Can be calculated from order items if needed
                item_weight: 0.5, // Default weight, should be configurable
                item_description: `Order ${order.order_number}`,
                delivery_type: 48 // Default to normal delivery
            };

            const deliveryResult = await deliveryService.createDeliveryOrder(
                shopId,
                deliveryPayload
            );

            // Update order with delivery tracking info
            await order.update({
                delivery_provider: deliveryResult.provider,
                delivery_consignment_id: deliveryResult.consignment_id,
                delivery_tracking_code: deliveryResult.tracking_code,
                delivery_status: deliveryResult.status,
                delivery_dispatched_at: new Date(),
                fulfillment_status: 'fulfilled'
            });
        }
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
    createReturnRequest
};
