const { Order, OrderItem, Product, Customer, UserShop, OrderReturn } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { sequelize } = require('src/utils/database/database-setup');
const { Op } = require('sequelize');
const deliveryService = require('src/modules/delivery/delivery.service');
const subscriptionService = require('src/modules/subscription/subscription.service');
const { createLogger } = require('src/utils/structured-logger');

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
 * Generate next order number (ORD-001, ORD-002...)
 */
const generateOrderNumber = async (shopId) => {
    const lastOrder = await Order.findOne({
        where: { shop_id: shopId },
        order: [['created_at', 'DESC']],
        attributes: ['order_number']
    });

    let nextNumber = 1;
    if (lastOrder && lastOrder.order_number) {
        // Extract number from ORD-XXX
        const parts = lastOrder.order_number.split('-');
        if (parts.length === 2 && !isNaN(parts[1])) {
            nextNumber = parseInt(parts[1]) + 1;
        }
    }

    return `ORD-${nextNumber.toString().padStart(3, '0')}`;
};

/**
 * Create a new order
 * CRITICAL: Tracks usage for billing on successful creation
 */
const createOrder = async (userId, shopId, orderData, requestId = null) => {
    const logger = createLogger(requestId, shopId, userId);
    
    await verifyShopAccess(userId, shopId);

    const transaction = await sequelize.transaction();

    try {
        // 1. Calculate totals and verify products
        let subtotal = 0;
        const validItems = [];

        for (const item of orderData.items) {
            const product = await Product.findOne({
                where: { id: item.product_id, shop_id: shopId }
            });

            if (!product) {
                throw new AppError(`Product not found: ${item.product_id}`, 404);
            }

            // Verify stock if tracking enabled
            if (product.track_quantity && !product.allow_backorder && product.quantity < item.quantity) {
                throw new AppError(`Insufficient stock for product: ${product.name}`, 400);
            }

            // Use provided price (manual override) or product price
            const unitPrice = item.price !== undefined ? parseFloat(item.price) : parseFloat(product.price);
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

        // 2. Generate Order Number
        const orderNumber = await generateOrderNumber(shopId);

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
            note: orderData.note
        }, { transaction });

        // 4. Create Order Items and update stock
        for (const validItem of validItems) {
            await OrderItem.create({
                order_id: order.id,
                product_id: validItem.product_id,
                quantity: validItem.quantity,
                price: validItem.price,
                total: validItem.total
            }, { transaction });

            // Update product stock if tracked
            if (validItem.productInstance.track_quantity) {
                await validItem.productInstance.decrement('quantity', {
                    by: validItem.quantity,
                    transaction
                });
            }
        }

        await transaction.commit();
        // Order now persisted in database

        // ATOMIC: Track usage ONLY after successful DB commit
        // Uses transaction-safe idempotent tracking with request_id
        // Usage increments ONLY on successful database persistence
        try {
            const usageResult = await subscriptionService.trackUsage(
                shopId,
                'orders',
                1,
                requestId, // Request-scoped idempotency key - prevents double counting
                {
                    resourceId: order.id,
                    orderNumber: order.order_number,
                    total: total,
                    itemCount: validItems.length
                }
            );
            
            logger.logUsage('order_created', shopId, userId, {
                orderId: order.id,
                orderNumber: order.order_number,
                total: total,
                itemCount: validItems.length,
                transactionId: usageResult.transactionId,
                isRetry: usageResult.isRetry
            });
        } catch (usageError) {
            // CRITICAL errors: usage_limit_exceeded, validation errors
            if (usageError.code === 'USAGE_LIMIT_EXCEEDED') {
                logger.error('Usage limit exceeded on order', usageError, { severity: 'critical' });
                throw usageError;
            }
            
            // Non-critical errors: transient tracking issues don't fail order
            logger.error('Failed to track order usage', usageError, {
                orderId: order.id,
                severity: 'warning'
            });
        }

        return await getOrderById(order.id, userId, shopId);

    } catch (error) {
        try { await transaction.rollback(); } catch (_) { /* already committed */ }
        throw error;
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
        const search = filters.search.toLowerCase();
        whereClause[Op.or] = [
            { order_number: { [Op.iLike]: `%${search}%` } },
            { '$customer.name$': { [Op.iLike]: `%${search}%` } },
            { '$customer.phone$': { [Op.iLike]: `%${search}%` } }
        ];
    }

    const orders = await Order.findAll({
        where: whereClause,
        include: includeOptions,
        order: [['created_at', 'DESC']]
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
