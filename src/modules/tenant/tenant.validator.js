const { param } = require('express-validator');

const getTenantValidator = [
    param('tenantId')
        .notEmpty()
        .withMessage('Tenant ID is required')
        .isUUID()
        .withMessage('Invalid tenant ID')
];

const getTenantShopValidator = [
    param('tenantId')
        .notEmpty()
        .withMessage('Tenant ID is required')
        .isUUID()
        .withMessage('Invalid tenant ID'),
    param('shopId')
        .notEmpty()
        .withMessage('Shop ID is required')
        .isUUID()
        .withMessage('Invalid shop ID')
];

module.exports = {
    getTenantValidator,
    getTenantShopValidator
};