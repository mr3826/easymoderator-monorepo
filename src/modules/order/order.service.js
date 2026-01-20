const { Order, OrderItem, Product, Customer, UserShop } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { sequelize } = require('src/utils/database/database-setup');
const { Op } = require('sequelize');

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
 */
const createOrder = async (userId, shopId, orderData) => {
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
                // for updating stock later if needed
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
            order_number: orderNumber,
            channel: orderData.channel || 'manual',
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

        return await getOrderById(order.id, userId, shopId);

    } catch (error) {
        await transaction.rollback();
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
    const allowedUpdates = ['payment_status', 'fulfillment_status', 'note'];
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
                attributes: ['id', 'name', 'number', 'email']
            },
            {
                model: OrderItem,
                as: 'items',
                include: [{
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'sku', 'images']
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
            attributes: ['id', 'name', 'number', 'email']
        },
        {
            model: OrderItem,
            as: 'items',
            attributes: ['id', 'quantity', 'total'] // Light include for list
        }
    ];

    if (filters.search) {
        const search = filters.search.toLowerCase();
        whereClause[Op.or] = [
            { order_number: { [Op.iLike]: `%${search}%` } },
            { '$customer.name$': { [Op.iLike]: `%${search}%` } },
            { '$customer.number$': { [Op.iLike]: `%${search}%` } }
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
}

module.exports = {
    createOrder,
    updateOrder,
    getOrderById,
    listOrders,
    deleteOrder
};
