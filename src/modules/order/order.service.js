const { Order, OrderItem, Product, Customer, UserShop, OrderReturn } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { sequelize } = require('../../utils/database/database-setup');
const { Op } = require('sequelize');
const deliveryService = require('../delivery/delivery.service');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');

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
const createOrder = async (userId, shopId, orderData, requestId = null) => {
    const logger = createLogger(requestId, shopId, userId);
    await verifyShopAccess(userId, shopId);

    // USAGE_LIMIT_EXCEEDED check BEFORE creating the DB transaction
    await subscriptionService.checkOrderLimit(shopId);

    // RTO Shield: check phone blacklist for COD orders before opening transaction
    const isCodOrder = !orderData.payment_status || orderData.payment_status === 'unpaid' || orderData.payment_status === 'pending';
    if (isCodOrder && orderData.customer_phone) {
        const RtoShieldService = require('../rto-shield/rto-shield.service');
        const rtoResult = await RtoShieldService.checkPhone(orderData.customer_phone, shopId);
        if (rtoResult.flagged && rtoResult.risk_score >= 70) {
            throw new AppError(
                `Order blocked by RTO Shield: ${rtoResult.reason} (risk score: ${rtoResult.risk_score})`,
                422
            );
        }
    }

    // Strict state machine definition
    const ORDER_STATES = ['draft', 'placed', 'paid', 'fulfilled', 'cancelled', 'refunded'];
    const PAYMENT_STATES = ['pending', 'paid', 'unpaid', 'refunded', 'partially_paid'];

    // Idempotency key check
    if (requestId) {
        const existingOrder = await Order.findOne({ where: { shop_id: shopId, idempotency_key: requestId } });
        if (existingOrder) return existingOrder;
    }

    const transaction = await sequelize.transaction();
    try {
        // 1. Fetch all products in one query (N+1 fix)
        const itemIds = orderData.items.map((item) => item.product_id);
        const products = await Product.findAll({
            where: { id: { [Op.in]: itemIds }, shop_id: shopId },
            transaction
        });
        const productMap = new Map(products.map((p) => [p.id, p]));

        let subtotal = 0;
        const validItems = [];
        for (const item of orderData.items) {
            const product = productMap.get(item.product_id);
            if (!product) throw new AppError(`Product not found: ${item.product_id}`, 404);
            // Verify stock if tracking enabled
            if (product.track_quantity && !product.allow_backorder && product.quantity < item.quantity) {
                throw new AppError(`Insufficient stock for product: ${product.name}`, 400);
            }
            // Use server-side catalog price to prevent client-side price tampering.
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
        const discount = parseFloat(orderData.discount || 0);
        const tax = parseFloat(orderData.tax || 0);
        const deliveryFee = parseFloat(orderData.delivery_fee || 0);
        const total = subtotal - discount + tax + deliveryFee;

        // M8: COD order value cap — configurable via COD_ORDER_MAX_VALUE env (default 50000 BDT)
        if (isCodOrder) {
            const COD_MAX = parseInt(process.env.COD_ORDER_MAX_VALUE || '50000', 10);
            if (total > COD_MAX) {
                throw new AppError(
                    `COD orders cannot exceed ৳${COD_MAX.toLocaleString()}. Please use an online payment method for large orders.`,
                    422
                );
            }
        }

        // 2. Generate Order Number
        const orderNumber = await generateOrderNumber(shopId, transaction);
        // 3. Create Order
        const order = await Order.create({
            shop_id: shopId,
            customer_id: orderData.customer_id,
            customer_name: orderData.customer_name,
            order_number: orderNumber,
            channel: orderData.channel || 'manual',
            order_status: 'draft',
            payment_status: orderData.payment_status || 'pending',
            fulfillment_status: orderData.fulfillment_status || 'unfulfilled',
            subtotal: subtotal,
            discount: discount,
            tax: tax,
            delivery_fee: deliveryFee,
            total: total,
            note: orderData.note,
            idempotency_key: requestId || null
        }, { transaction });
        // 4. Create Order Items and update stock atomically
        for (const validItem of validItems) {
            await OrderItem.create({
                order_id: order.id,
                product_id: validItem.product_id,
                quantity: validItem.quantity,
                price: validItem.price,
                total: validItem.total
            }, { transaction });
            // Atomic stock deduction
            if (validItem.productInstance.track_quantity) {
                await validItem.productInstance.decrement('quantity', {
                    by: validItem.quantity,
                    transaction
                });
            }
        }
        // Final usage limit check before commit (defense in depth)
        await subscriptionService.checkOrderLimit(shopId);
        await transaction.commit();
        // ATOMIC: Track usage ONLY after successful DB commit
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
        // Enforce payment state consistency
        if (!PAYMENT_STATES.includes(order.payment_status)) {
            order.payment_status = 'pending';
            await order.save();
        }
        // Enforce strict order state machine
        if (!ORDER_STATES.includes(order.order_status)) {
            order.order_status = 'draft';
            await order.save();
        }
        return order;
    } catch (err) {
        try { await transaction.rollback(); } catch (_) { /* already committed */ }
        throw err;
    }
};

/**
 * Update an order (Status/Note only for now)
 */
const updateOrder = async (orderId, userId, shopId, updateData) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    // Allow updating statuses and note
    const allowedUpdates = ['order_status', 'payment_status', 'fulfillment_status', 'note'];
    const updates = {};

    Object.keys(updateData).forEach(key => {
        if (allowedUpdates.includes(key)) {
            updates[key] = updateData[key];
        }
    });

    await order.update(updates);

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
        // Try to get customer email
        let customerEmail = null;
        if (order.customer_id) {
            // Enforce tenant scoping
            const customer = await Customer.findOne({ where: { id: order.customer_id, shop_id: order.shop_id } });
            if (customer && customer.email) customerEmail = customer.email;
        }
        // Fallback: check order.customer_email if present
        if (!customerEmail && order.customer_email) customerEmail = order.customer_email;

        if (customerEmail && invoice) {
            const subject = `Invoice for your order ${order.order_number}`;
            const text = `Dear ${order.customer_name || 'Customer'},\n\nThank you for your order.\n\nInvoice Number: ${invoice.invoice_number}\nOrder Number: ${order.order_number}\nTotal: ${order.total}\n\nPlease pay by: ${invoice.due_date.toDateString()}\n\nThank you.`;
            const html = `<p>Dear ${order.customer_name || 'Customer'},</p><p>Thank you for your order.</p><ul><li><b>Invoice Number:</b> ${invoice.invoice_number}</li><li><b>Order Number:</b> ${order.order_number}</li><li><b>Total:</b> ${order.total}</li></ul><p>Please pay by: <b>${invoice.due_date.toDateString()}</b></p><p>Thank you.</p>`;
            await sendEmail({ to: customerEmail, subject, text, html });
        }
    } catch (err) {
        console.error('Invoice email send failed:', err.message);
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

    await order.update({
        order_status: 'cancelled',
        note: reason ? `Cancelled: ${reason}` : order.note
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
