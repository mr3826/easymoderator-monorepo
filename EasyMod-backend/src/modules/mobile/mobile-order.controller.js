'use strict';

const asyncHandler = require('../../utils/async-middleware-handler');
const { AppError, sendSuccess } = require('../../utils/AppError');
const orderService = require('../order/order.service');

const MAX_PAGE_SIZE = 50;
const ORDER_STATUSES = new Set(['draft', 'confirmed', 'finalized', 'cancelled', 'returned']);
const PAYMENT_STATUSES = new Set(['pending', 'paid', 'failed', 'refunded', 'partial']);
const FULFILLMENT_STATUSES = new Set(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']);

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

function filtersFrom(req) {
    const filters = {
        page: positiveInteger(req.query.page, 1, 10_000),
        limit: positiveInteger(req.query.limit, 25, MAX_PAGE_SIZE),
    };
    if (req.query.search) filters.search = String(req.query.search).trim().slice(0, 100);
    if (ORDER_STATUSES.has(String(req.query.order_status))) filters.order_status = String(req.query.order_status);
    if (PAYMENT_STATUSES.has(String(req.query.payment_status))) filters.payment_status = String(req.query.payment_status);
    if (FULFILLMENT_STATUSES.has(String(req.query.fulfillment_status))) {
        filters.fulfillment_status = String(req.query.fulfillment_status);
    }
    if (req.query.start_date) filters.start_date = String(req.query.start_date);
    if (req.query.end_date) filters.end_date = String(req.query.end_date);
    return filters;
}

const getOrders = asyncHandler(async (req, res) => {
    const filters = filtersFrom(req);
    const orders = await orderService.listOrders(req.user.userId, req.shop.id, {
        ...filters,
        limit: filters.limit + 1,
    });
    const hasNextPage = orders.length > filters.limit;
    sendSuccess(res, {
        orders: hasNextPage ? orders.slice(0, filters.limit) : orders,
        pagination: {
            page: filters.page,
            limit: filters.limit,
            hasNextPage,
        },
    });
});

const getOrder = asyncHandler(async (req, res) => {
    const order = await orderService.getOrderById(orderIdFrom(req), req.user.userId, req.shop.id);
    sendSuccess(res, order);
});

module.exports = { getOrders, getOrder };
