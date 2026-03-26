const { Order, UserShop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { Op } = require('sequelize');

/**
 * Verify user has access to the shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: { user_id: userId, shop_id: shopId, is_active: true }
    });
    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};

/**
 * Initiate a return request on a delivered order.
 * Verifies the order belongs to the shop, is 'delivered', and stores return metadata.
 * Returns the generated return reference.
 */
const initiateReturn = async (shopId, orderId, customerId, reason) => {
    const order = await Order.findOne({ where: { id: orderId, shop_id: shopId } });
    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (order.order_status !== 'delivered') {
        throw new AppError(
            `Return can only be initiated for delivered orders. Current status: '${order.order_status}'`,
            400
        );
    }

    const existingMeta = order.metadata || {};
    if (existingMeta.returnRequested) {
        throw new AppError('A return request already exists for this order', 409);
    }

    const returnRef = `RET-${Date.now()}`;

    await order.update({
        metadata: {
            ...existingMeta,
            returnRequested: true,
            returnReason: reason || null,
            returnRef,
            returnStatus: 'pending',
            returnRequestedAt: new Date(),
            returnCustomerId: customerId || null
        }
    });

    return { returnRef, orderId: order.id, orderNumber: order.order_number };
};

/**
 * Update the return status on an order.
 * status: 'approved' | 'rejected' | 'refunded'
 */
const updateReturnStatus = async (shopId, orderId, status) => {
    const VALID_STATUSES = ['approved', 'rejected', 'refunded'];
    if (!VALID_STATUSES.includes(status)) {
        throw new AppError(`Invalid return status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400);
    }

    const order = await Order.findOne({ where: { id: orderId, shop_id: shopId } });
    if (!order) {
        throw new AppError('Order not found', 404);
    }

    const existingMeta = order.metadata || {};
    if (!existingMeta.returnRequested) {
        throw new AppError('No return request found for this order', 404);
    }

    await order.update({
        metadata: {
            ...existingMeta,
            returnStatus: status,
            returnStatusUpdatedAt: new Date()
        }
    });

    return {
        orderId: order.id,
        orderNumber: order.order_number,
        returnRef: existingMeta.returnRef,
        returnStatus: status
    };
};

/**
 * List orders that have a return request (returnRequested: true in metadata).
 * Filters are passed through and optionally support returnStatus.
 */
const getReturnRequests = async (shopId, filters = {}) => {
    const dialect = require('../../utils/database/database-setup').sequelize.getDialect();

    const orders = await Order.findAll({
        where: { shop_id: shopId },
        order: [['created_at', 'DESC']]
    });

    // Filter in-memory since JSON querying varies by DB dialect
    let returnOrders = orders.filter(o => {
        const meta = o.metadata || {};
        return meta.returnRequested === true;
    });

    if (filters.returnStatus) {
        returnOrders = returnOrders.filter(o => {
            const meta = o.metadata || {};
            return meta.returnStatus === filters.returnStatus;
        });
    }

    return returnOrders.map(o => {
        const meta = o.metadata || {};
        return {
            orderId: o.id,
            orderNumber: o.order_number,
            customerName: o.customer_name,
            customerPhone: o.customer_phone,
            orderStatus: o.order_status,
            total: o.total,
            returnRef: meta.returnRef,
            returnReason: meta.returnReason,
            returnStatus: meta.returnStatus,
            returnRequestedAt: meta.returnRequestedAt
        };
    });
};

module.exports = {
    initiateReturn,
    updateReturnStatus,
    getReturnRequests
};
