const orderService = require('./order.service');
const { validationResult } = require('express-validator');
const { AppError } = require('src/utils/AppError');

/**
 * Create a new order (legacy)
 */
const createOrder = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const order = await orderService.createOrder(
            req.user.userId,
            shopId,
            req.body // Already validated by Joi
        );

        res.status(201).json({
            success: true,
            data: order
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update an order (legacy)
 */
const updateOrder = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { order_id, ...updateData } = req.body;
        const order = await orderService.updateOrder(
            order_id,
            req.user.userId,
            shopId,
            updateData
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
 * Get a single order (legacy)
 */
const getOrder = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
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
 * List orders with filters (legacy)
 */
const listOrders = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        // Extract filters
        const filters = req.query; // Already validated
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
 * Delete an order (legacy)
 */
const deleteOrder = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { orderId } = req.body; // Already validated
        const order = await orderService.confirmOrder(
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
 * RESTful: Get orders with pagination and filters
 */
const getOrders = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const options = req.query; // Already validated
        const result = await orderService.listOrders(req.user.userId, shopId, options);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Get order by ID
 */
const getOrderById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const order = await orderService.getOrderById(id, req.user.userId, shopId);

        res.status(200).json({
            success: true,
            data: order
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Get orders by customer
 */
const getOrdersByCustomer = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { customerId } = req.params;
        const orders = await orderService.getOrdersByCustomer(
            req.user.userId,
            shopId,
            customerId,
            req.query
        );

        res.status(200).json({
            orders: orders.map(order => ({
                order_id: order.id,
                status: order.order_status,
                total: order.total,
                created_at: order.created_at
            })),
            total: orders.length
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Cancel order
 */
const cancelOrder = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { orderId } = req.params;
        const { reason, customer_id } = req.body;

        const order = await orderService.cancelOrder(
            req.user.userId,
            shopId,
            orderId,
            reason,
            customer_id
        );

        res.status(200).json({
            order_id: order.id,
            status: order.order_status,
            refund_status: 'pending',
            updated_at: order.updated_at
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Create return request
 */
const createReturnRequest = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { orderId } = req.params;
        const request = await orderService.createReturnRequest(
            req.user.userId,
            shopId,
            orderId,
            req.body
        );

        res.status(201).json({
            return_request_id: request.id,
            status: request.status,
            created_at: request.created_at
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Create order
 */
const createOrderRest = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const order = await orderService.createOrder(
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        res.status(201).json({
            success: true,
            data: order
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Update order by ID
 */
const updateOrderById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const order = await orderService.updateOrder(
            id,
            req.user.userId,
            shopId,
            req.body // Already validated
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
 * RESTful: Delete order by ID
 */
const deleteOrderById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const result = await orderService.deleteOrder(
            id,
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

module.exports = {
    // RESTful methods
    getOrders,
    getOrderById,
    getOrdersByCustomer,
    cancelOrder,
    createReturnRequest,
    createOrderRest,
    updateOrderById,
    deleteOrderById,
    // Legacy methods (for backward compatibility)
    createOrder,
    updateOrder,
    getOrder,
    listOrders,
    deleteOrder,
    createDraftOrder,
    confirmOrder
};
