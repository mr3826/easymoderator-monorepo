const { Order } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { UserShop } = require('src/modules/entities');

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
 * Confirm COD payment for an order
 */
const confirmCodPayment = async (orderId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (order.order_status !== 'confirmed') {
        throw new AppError('Order must be confirmed before payment can be processed', 400);
    }

    if (order.payment_status !== 'pending') {
        throw new AppError(`Payment status is already ${order.payment_status}`, 400);
    }

    // Update payment status to unpaid (COD confirmed but not yet paid)
    await order.update({ payment_status: 'unpaid' });

    // TODO: In a real implementation, this would trigger finalization
    // For now, just return the updated order
    return order;
};

module.exports = {
    confirmCodPayment
};