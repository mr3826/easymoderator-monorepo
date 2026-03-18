const { body } = require('express-validator');

/**
 * Validator for updating subscription plan
 */
const updatePlanValidator = [
    body('plan_code')
        .optional()
        .isIn(['FREE', 'GROWTH', 'PRO', 'BUSINESS'])
        .withMessage('plan_code must be one of FREE, GROWTH, PRO, BUSINESS'),
    body().custom((value) => {
        if (value.plan_code) {
            return true;
        }

        const hasLegacyFields =
            value.plan_name !== undefined &&
            value.plan_price !== undefined &&
            value.conversations_limit !== undefined &&
            value.orders_limit !== undefined &&
            value.products_limit !== undefined;

        if (!hasLegacyFields) {
            throw new Error('Provide either plan_code or full custom plan details');
        }

        return true;
    }),
    body('plan_name')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Plan name is required'),
    body('plan_price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Plan price must be a positive number'),
    body('billing_cycle')
        .isIn(['monthly', 'yearly'])
        .withMessage('Billing cycle must be either monthly or yearly'),
    body('conversations_limit')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Conversations limit must be a positive integer'),
    body('orders_limit')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Orders limit must be a positive integer'),
    body('products_limit')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Products limit must be a positive integer'),
    body('features')
        .optional()
        .isObject()
        .withMessage('Features must be an object')
];

/**
 * Validator for requesting conversation pack
 */
const requestConversationPackValidator = [
    body('amount')
        .isInt({ min: 1 })
        .withMessage('Amount must be a positive integer'),
    body('price')
        .isFloat({ min: 0 })
        .withMessage('Price must be a positive number')
];

module.exports = {
    updatePlanValidator,
    requestConversationPackValidator
};
