const orderService = require('./order.service');
const returnService = require('./return.service');
const { validationResult } = require('express-validator');
const { AppError } = require('../../utils/AppError');
const deliveryService = require('../delivery/delivery.service');

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

        const order_id = req.body.order_id || req.body.id || req.query.order_id || req.query.id;
        if (!order_id) {
            throw new AppError('Order ID is required', 400);
        }
        const updateData = { ...req.body };
        delete updateData.order_id;
        delete updateData.id;
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

        const orderId = req.query.order_id || req.query.id;
        if (!orderId) {
            throw new AppError('Order ID is required', 400);
        }
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

        const orderId = req.body.order_id || req.body.id || req.query.order_id || req.query.id;
        if (!orderId) {
            throw new AppError('Order ID is required', 400);
        }
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

        const orderId = req.params.orderId || req.params.id || req.body.orderId;
        if (!orderId) {
            throw new AppError('Order ID is required', 400);
        }

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
            success: true,
            data: order,
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
 * Only orders in 'pending' or 'draft' status can be edited.
 * Edits to 'processing', 'shipped', or 'delivered' orders are rejected with 409.
 * All changes are recorded in the order metadata audit_log.
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

/**
 * Feature: Send tracking notification to customer
 * POST /orders/:id/send-tracking
 */
const sendTrackingNotification = async (req, res, next) => {
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

        const { id } = req.params;
        const { trackingNumber, courier, estimatedDelivery } = req.body;

        if (!trackingNumber || !courier) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'trackingNumber and courier are required'
                }
            });
        }

        const orderTrackingService = require('./order-tracking.service');
        const result = await orderTrackingService.sendTrackingNotification(id, shopId, {
            trackingNumber,
            courier,
            estimatedDelivery: estimatedDelivery || null
        });

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Bug #7: Bulk order import.
 * POST /orders/bulk
 * Body: { orders: [ { customer_name, customer_phone, delivery_address, items: [...], ... } ] }
 * Returns per-row results so the frontend can show which rows succeeded and which failed.
 */
const bulkCreateOrders = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { orders } = req.body;
        if (!Array.isArray(orders) || orders.length === 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'orders must be a non-empty array' }
            });
        }

        if (orders.length > 500) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Maximum 500 orders per bulk import' }
            });
        }

        const results = await Promise.allSettled(
            orders.map((orderData, index) =>
                orderService.createOrder(req.user.userId, shopId, orderData)
                    .then(order => ({ index: index + 1, success: true, order_id: order.id, order_number: order.order_number }))
                    .catch(err => ({ index: index + 1, success: false, error: err.message }))
            )
        );

        const settled = results.map(r => r.value);
        const succeeded = settled.filter(r => r.success).length;
        const failed    = settled.filter(r => !r.success).length;

        res.status(207).json({
            success: true,
            summary: { total: orders.length, succeeded, failed },
            results: settled
        });
    } catch (error) {
        next(error);
    }
};

/**
 * D3: Initiate a return request for a delivered order
 * POST /orders/:orderId/return
 * Body: { customerId?, reason }
 */
const initiateReturn = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { orderId } = req.params;
        const { customerId, reason } = req.body;

        const result = await returnService.initiateReturn(shopId, orderId, customerId, reason);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * D3: Update return status for an order
 * PATCH /orders/:orderId/return/status
 * Body: { status }
 */
const updateReturnStatus = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { orderId } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'status is required' }
            });
        }

        const result = await returnService.updateReturnStatus(shopId, orderId, status);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * D3: List all return requests for the shop
 * GET /orders/returns
 */
const getReturnRequests = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const filters = req.query;
        const returns = await returnService.getReturnRequests(shopId, filters);
        res.status(200).json({ success: true, data: returns });
    } catch (error) {
        next(error);
    }
};

const bookCourier = async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const shopId = req.headers['x-shop-id'] || req.user?.shopId;
        const { provider, recipient_name, recipient_phone, recipient_address, cod_amount, weight_kg, item_description } = req.body;

        if (!shopId) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Shop ID required' } });
        }

        const { Order } = require('../entities');
        const order = await Order.findOne({ where: { id: orderId, shop_id: shopId } });
        if (!order) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
        }

        const orderData = {
            order_number: order.id.slice(0, 8).toUpperCase(),
            recipient_name: recipient_name || order.customer_name,
            recipient_phone: recipient_phone || order.customer_phone,
            recipient_address: recipient_address || (typeof order.delivery_address === 'object' ? `${order.delivery_address.street_address}, ${order.delivery_address.upazila}, ${order.delivery_address.district}` : order.delivery_address),
            cod_amount: cod_amount ?? order.total,
            weight: weight_kg || 0.5,
            note: item_description || '',
        };

        const result = await deliveryService.createDeliveryOrder(shopId, orderData, provider || null);

        // Persist tracking info on the order
        await order.update({
            delivery_provider: result.provider || provider,
            delivery_consignment_id: result.consignment_id,
            delivery_tracking_code: result.tracking_code,
            delivery_dispatched_at: new Date(),
        });

        res.json({
            success: true,
            data: {
                tracking_id: result.tracking_code || result.consignment_id,
                consignment_id: result.consignment_id,
                provider: result.provider || provider,
                booked_at: new Date().toISOString(),
            }
        });
    } catch (error) {
        const statusCode = error.message?.includes('No active delivery') ? 400 : 500;
        res.status(statusCode).json({
            success: false,
            error: { code: 'COURIER_BOOKING_FAILED', message: error.message }
        });
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
    bulkCreateOrders,
    // Return automation (D3)
    initiateReturn,
    updateReturnStatus,
    getReturnRequests,
    // Legacy methods (for backward compatibility)
    createOrder,
    updateOrder,
    getOrder,
    listOrders,
    deleteOrder,
    createDraftOrder,
    confirmOrder,
    bookCourier
};
