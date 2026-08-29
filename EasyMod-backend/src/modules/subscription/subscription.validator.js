const { body } = require('express-validator');

/**
 * Validator for updating subscription plan
 */
const updatePlanValidator = [
    body('plan_code')
        .isIn(['SHURU', 'GROWTH'])
        .withMessage('plan_code must be one of SHURU, GROWTH'),
    body('billing_cycle')
        .optional()
        .isIn(['monthly', 'yearly'])
        .withMessage('Billing cycle must be either monthly or yearly'),
    body().custom((value) => {
        const allowed = new Set(['plan_code', 'billing_cycle']);
        const unexpected = Object.keys(value || {}).filter((key) => !allowed.has(key));
        if (unexpected.length > 0) {
            throw new Error('Prices, limits, and features are controlled by the server');
        }
        return true;
    })
];

module.exports = {
    updatePlanValidator
};
