const orderService = require('./order.service');
const { validationResult } = require('express-validator');
const { AppError } = require('src/utils/AppError');

/**
 * Create a new order
 */
const createOrder = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const order = await orderService.createOrder(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            data: order
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update an order
 */
const updateOrder = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { orderId, ...updateData } = req.body;
        const order = await orderService.updateOrder(
            orderId,
            req.user.userId,
            shopId,
            updateData
        );

        res.status(200).json({
            success: true,
            message: 'Order updated successfully',
            data: order
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get a single order
 */
const getOrder = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { orderId } = req.query;
        const order = await orderService.getOrderById(
            orderId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: order
        });
    } catch (error) {
        next(error);
    }
};

/**
 * List orders with filters
 */
const listOrders = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        // Extract filters
        const filters = {
            search: req.query.search,
            start_date: req.query.start_date,
            end_date: req.query.end_date,
            payment_status: req.query.payment_status,
            fulfillment_status: req.query.fulfillment_status
        };

        const orders = await orderService.listOrders(
            req.user.userId,
            shopId,
            filters
        );

        res.status(200).json({
            success: true,
            data: orders
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete an order
 */
const deleteOrder = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { orderId } = req.body;
        const result = await orderService.deleteOrder(
            orderId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Create a draft order
 */
const createDraftOrder = async (req, res, next) => {
    // Same as createOrder for now, since createOrder creates drafts
    return createOrder(req, res, next);
};

/**
 * Confirm a draft order
 */
const confirmOrder = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { orderId } = req.body;
        const order = await orderService.confirmOrder(
            orderId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            message: 'Order confirmed successfully',
            data: order
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get single order by ID (RESTful)
 */
const getOrderById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { id } = req.params;
        const order = await orderService.getOrderById(
            id,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: order
        });
    } catch (error) {
        next(error);
    }
};

/**
 * List orders (RESTful)
 */
const getOrders = async (req, res, next) => {
    // Same as listOrders
    return listOrders(req, res, next);
};

module.exports = {
    createOrder,
    updateOrder,
    getOrder,
    listOrders,
    deleteOrder,
    createDraftOrder,
    confirmOrder,
    getOrderById,
    getOrders
};
