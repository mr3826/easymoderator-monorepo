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

module.exports = {
    confirmCodPaymentValidator
};