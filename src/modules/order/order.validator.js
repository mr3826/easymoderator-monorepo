const { body, query } = require('express-validator');

/**
 * Validator for creating an order
 */
const createOrderValidator = [
    // Customer Validation
    body('customer_id')
        .trim()
        .notEmpty()
        .withMessage('Customer ID is required')
        .isUUID()
        .withMessage('Customer ID must be a valid UUID'),

    body('channel')
        .optional()
        .trim(),

    // Products Validation
    body('items')
        .isArray({ min: 1 })
        .withMessage('Order must treat at least one item'),

    body('items.*.product_id')
        .notEmpty()
        .withMessage('Product ID is required for each item')
        .isUUID()
        .withMessage('Product ID must be a valid UUID'),

    body('items.*.quantity')
        .isInt({ min: 1 })
        .withMessage('Quantity must be at least 1'),

    body('items.*.price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Price must be a positive number'),

    body('items.*.total')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Total must be a positive number'),

    // Financials (Optional validations as they might be calculated or overridden)
    body('discount')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Discount must be a positive number'),

    body('delivery_fee')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Delivery fee must be a positive number'),

    body('tax')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Tax must be a positive number'),

    // Statuses
    body('payment_status')
        .optional()
        .isIn(['pending', 'paid', 'unpaid', 'refunded', 'partially_paid'])
        .withMessage('Invalid payment status'),

    body('fulfillment_status')
        .optional()
        .isIn(['unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled'])
        .withMessage('Invalid fulfillment status'),

    body('note')
        .optional()
        .trim()
];

/**
 * Validator for updating an order
 */
const updateOrderValidator = [
    body('orderId')
        .trim()
        .notEmpty()
        .withMessage('Order ID is required')
        .isUUID()
        .withMessage('Order ID must be a valid UUID'),

    body('payment_status')
        .optional()
        .isIn(['pending', 'paid', 'unpaid', 'refunded', 'partially_paid'])
        .withMessage('Invalid payment status'),

    body('fulfillment_status')
        .optional()
        .isIn(['unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled'])
        .withMessage('Invalid fulfillment status'),

    body('note')
        .optional()
        .trim()
];

/**
 * Validator for listing orders
 */
const listOrdersValidator = [
    query('search')
        .optional()
        .trim(),

    query('start_date')
        .optional()
        .isISO8601()
        .withMessage('Start date must be a valid ISO 8601 date'),

    query('end_date')
        .optional()
        .isISO8601()
        .withMessage('End date must be a valid ISO 8601 date'),

    query('payment_status')
        .optional()
        .isIn(['pending', 'paid', 'unpaid', 'refunded', 'partially_paid']),

    query('fulfillment_status')
        .optional()
        .isIn(['unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled'])
];

/**
 * Validator for getting/deleting order
 */
const orderIdValidator = [
    query('orderId')
        .trim()
        .notEmpty()
        .withMessage('Order ID is required')
        .isUUID()
        .withMessage('Order ID must be a valid UUID')
];

module.exports = {
    createOrderValidator,
    updateOrderValidator,
    listOrdersValidator,
    orderIdValidator
};
