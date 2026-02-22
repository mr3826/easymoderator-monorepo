const { body } = require('express-validator');

/**
 * Validator for COD payment confirmation
 */
const confirmCodPaymentValidator = [
    body('orderId')
        .trim()
        .notEmpty()
        .withMessage('Order ID is required')
        .isUUID()
        .withMessage('Order ID must be a valid UUID')
];

/**
 * Validator for saving payment configuration
 */
const savePaymentConfigValidator = [
    body('gateway')
        .trim()
        .notEmpty()
        .withMessage('Gateway is required')
        .isIn(['cod', 'aamarpay', 'sslcommerz', 'self-mfs'])
        .withMessage('Invalid payment gateway'),
    body('is_enabled')
        .optional()
        .isBoolean()
        .withMessage('is_enabled must be a boolean'),
    body('credentials')
        .optional()
        .isObject()
        .withMessage('Credentials must be an object'),
    body('config')
        .optional()
        .isObject()
        .withMessage('Config must be an object')
];

/**
 * Validator for initiating payment
 */
const initiatePaymentValidator = [
    body('orderId')
        .trim()
        .notEmpty()
        .withMessage('Order ID is required')
        .isUUID()
        .withMessage('Order ID must be a valid UUID'),
    body('gateway')
        .trim()
        .notEmpty()
        .withMessage('Gateway is required')
        .isIn(['aamarpay', 'sslcommerz'])
        .withMessage('Invalid payment gateway')
];

module.exports = {
    confirmCodPaymentValidator,
    savePaymentConfigValidator,
    initiatePaymentValidator
};
