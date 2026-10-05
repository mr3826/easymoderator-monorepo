'use strict';

const asyncHandler = require('../../utils/async-middleware-handler');
const { AppError, sendSuccess } = require('../../utils/AppError');
const customerService = require('../customer/customer.service');
const orderService = require('../order/order.service');

const { CustomerDeliveryStats } = require('../entities');

function customerIdFrom(req) {
    const customerId = String(req.params.customerId || '').trim();
    if (!customerId || customerId.length > 100) {
        throw new AppError('Customer ID is required', 400, 'VALIDATION_ERROR');
    }
    return customerId;
}

const getCustomerQuickView = asyncHandler(async (req, res) => {
    const customerId = customerIdFrom(req);
    const customer = await customerService.getCustomerById(customerId, req.user.userId, req.shop.id);
    const orders = await orderService.getOrdersByCustomer(req.user.userId, req.shop.id, customerId, { limit: 10 });

    const phone = customer?.phone ? String(customer.phone).trim() : null;
    let deliveryStats = null;
    if (phone && CustomerDeliveryStats && typeof CustomerDeliveryStats.findOne === 'function') {
        deliveryStats = await CustomerDeliveryStats.findOne({
            where: { shop_id: req.shop.id, phone },
        }).catch(() => null);
    }

    let deliveredCount = 0;
    let rtoCount = 0;
    let cancelledCount = 0;

    for (const order of orders) {
        const oStatus = String(order.order_status || '').toLowerCase();
        const fStatus = String(order.fulfillment_status || '').toLowerCase();
        if (fStatus === 'delivered' || oStatus === 'delivered') deliveredCount++;
        if (fStatus === 'returned' || oStatus === 'returned') rtoCount++;
        if (oStatus === 'cancelled') cancelledCount++;
    }

    if (deliveryStats) {
        rtoCount = Math.max(rtoCount, Number(deliveryStats.rto_count || 0));
        const deliveredFromStats = Math.max(0, Number(deliveryStats.delivery_attempts || 0) - Number(deliveryStats.rto_count || 0));
        deliveredCount = Math.max(deliveredCount, deliveredFromStats);
    }

    const totalOrders = Math.max(orders.length, deliveredCount + rtoCount + cancelledCount);
    const returnRate = totalOrders > 0 ? Math.round((rtoCount / totalOrders) * 100) : 0;

    sendSuccess(res, {
        customer,
        orders,
        stats: {
            total_orders: totalOrders,
            delivered_count: deliveredCount,
            rto_count: rtoCount,
            cancelled_count: cancelledCount,
            return_rate: returnRate,
        },
    });
});

module.exports = { getCustomerQuickView };

