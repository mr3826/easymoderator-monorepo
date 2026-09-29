'use strict';

const asyncHandler = require('../../utils/async-middleware-handler');
const { AppError, sendSuccess } = require('../../utils/AppError');
const customerService = require('../customer/customer.service');
const orderService = require('../order/order.service');

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
    sendSuccess(res, { customer, orders });
});

module.exports = { getCustomerQuickView };
