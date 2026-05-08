const Joi = require('joi');

class OrderValidator {
    createOrder = {
        body: Joi.object({
            customer_id: Joi.string().uuid().optional().messages({
                'string.uuid': 'Customer ID must be a valid UUID'
            }),
            customer_name: Joi.string().trim().min(1).max(100).required().messages({
                'string.min': 'Customer name must be at least 1 character',
                'string.max': 'Customer name must not exceed 100 characters',
                'any.required': 'Customer name is required'
            }),
            customer_phone: Joi.string().trim().pattern(/^01[3-9]\d{8}$/).required().messages({
                'string.pattern.base': 'Must be a valid Bangladeshi mobile number (e.g. 01712345678)',
                'any.required': 'Phone/Mobile number is required'
            }),
            delivery_address: Joi.string().trim().min(10).max(500).optional().allow('').messages({
                'string.min': 'Delivery address must be at least 10 characters',
                'string.max': 'Delivery address must not exceed 500 characters'
            }),
            delivery_district: Joi.string().trim().max(100).optional(),
            delivery_thana: Joi.string().trim().max(100).optional(),
            delivery_area: Joi.string().trim().max(100).optional(),
            channel: Joi.string().trim().optional(),
            items: Joi.array().min(1).items(Joi.object({
                product_id: Joi.string().uuid().required().messages({
                    'string.uuid': 'Product ID must be a valid UUID',
                    'any.required': 'Product ID is required for each item'
                }),
                quantity: Joi.number().integer().min(1).required().messages({
                    'number.min': 'Quantity must be at least 1',
                    'any.required': 'Quantity is required'
                }),
                price: Joi.number().positive().optional().messages({
                    'number.positive': 'Price must be a positive number'
                }),
                total: Joi.number().positive().optional().messages({
                    'number.positive': 'Total must be a positive number'
                })
            })).required().messages({
                'array.min': 'Order must contain at least one item',
                'any.required': 'Items are required'
            }),
            discount: Joi.number().min(0).optional().messages({
                'number.min': 'Discount must be a non-negative number'
            }),
            delivery_fee: Joi.number().min(0).optional().messages({
                'number.min': 'Delivery fee must be a non-negative number'
            }),
            tax: Joi.number().min(0).optional().messages({
                'number.min': 'Tax must be a non-negative number'
            }),
            payment_status: Joi.string().valid('pending', 'paid', 'unpaid', 'refunded', 'partially_paid').default('unpaid').messages({
                'any.only': 'Invalid payment status'
            }),
            fulfillment_status: Joi.string().valid('unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled').optional().messages({
                'any.only': 'Invalid fulfillment status'
            }),
            note: Joi.string().trim().allow('').optional(),
            paymentMethodId: Joi.string().uuid().optional().messages({
                'string.uuid': 'Payment method ID must be a valid UUID'
            }),
            payment_method: Joi.string().trim().max(30).optional()
        })
    };

    updateOrder = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Order ID must be a valid UUID',
                'any.required': 'Order ID is required'
            })
        }),
        body: Joi.object({
            order_status: Joi.string().valid('draft', 'confirmed', 'processing', 'completed', 'cancelled').optional().messages({
                'any.only': 'Invalid order status'
            }),
            payment_status: Joi.string().valid('pending', 'paid', 'unpaid', 'refunded', 'partially_paid').optional().messages({
                'any.only': 'Invalid payment status'
            }),
            fulfillment_status: Joi.string().valid('unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled').optional().messages({
                'any.only': 'Invalid fulfillment status'
            }),
            note: Joi.string().trim().allow('').optional()
        }).min(1).messages({
            'object.min': 'At least one field to update is required'
        })
    };

    getOrders = {
        query: Joi.object({
            search: Joi.string().trim().optional(),
            start_date: Joi.date().iso().optional().messages({
                'date.format': 'Start date must be a valid ISO 8601 date'
            }),
            end_date: Joi.date().iso().optional().messages({
                'date.format': 'End date must be a valid ISO 8601 date'
            }),
            payment_status: Joi.string().valid('pending', 'paid', 'unpaid', 'refunded', 'partially_paid').optional(),
            fulfillment_status: Joi.string().valid('unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled').optional(),
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(20)
        })
    };

    getOrderById = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Order ID must be a valid UUID',
                'any.required': 'Order ID is required'
            })
        })
    };

    confirmOrder = {
        body: Joi.object({
            orderId: Joi.string().uuid().required().messages({
                'string.uuid': 'Order ID must be a valid UUID',
                'any.required': 'Order ID is required'
            })
        })
    };

    deleteOrder = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Order ID must be a valid UUID',
                'any.required': 'Order ID is required'
            })
        })
    };

    // Legacy route validators (for backward compatibility)
    // POST /order/update - expects order_id in body or query
    legacyUpdate = {
        body: Joi.object({
            order_id: Joi.string().uuid().optional(),
            id: Joi.string().uuid().optional(),
            order_status: Joi.string().valid('draft', 'confirmed', 'processing', 'completed', 'cancelled').optional(),
            payment_status: Joi.string().valid('pending', 'paid', 'unpaid', 'refunded', 'partially_paid').optional(),
            fulfillment_status: Joi.string().valid('unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled').optional(),
            note: Joi.string().trim().optional()
        }).min(1).messages({
            'object.min': 'At least one field to update is required'
        }).unknown(),
        query: Joi.object({
            order_id: Joi.string().uuid().optional(),
            id: Joi.string().uuid().optional()
        })
    };

    // POST /order/delete - expects order_id in body or query
    legacyDelete = {
        body: Joi.object({
            order_id: Joi.string().uuid().optional(),
            id: Joi.string().uuid().optional()
        }).or('order_id', 'id'),
        query: Joi.object({
            order_id: Joi.string().uuid().optional(),
            id: Joi.string().uuid().optional()
        }).or('order_id', 'id')
    };

    // GET /order/get - expects id in query
    legacyGet = {
        query: Joi.object({
            order_id: Joi.string().uuid().optional(),
            id: Joi.string().uuid().optional()
        }).or('order_id', 'id')
    };
}

module.exports = new OrderValidator();
