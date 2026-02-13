const { body, param } = require('express-validator');

const shopCreateValidator = [
    body('shop_name')
        .optional()
        .trim()
        .isLength({ min: 2 })
        .withMessage('Shop name must be at least 2 characters long')
];

const shopUpdateValidator = [
    body('shopId')
        .notEmpty()
        .withMessage('Shop ID is required')
        .isUUID()
        .withMessage('Invalid shop ID'),
    body('shop_name')
        .optional()
        .trim(),
    body('address')
        .optional()
        .trim(),
    body('phone')
        .optional()
        .trim(),
    body('opening_hours')
        .optional()
        .trim(),
    body('delivery_areas')
        .optional()
        .trim(),
    body('payment_methods')
        .optional()
        .trim(),
    body('logo')
        .optional()
        .trim(),
    body('banner_image')
        .optional()
        .trim(),
    body('shop_images')
        .optional()
        .isArray()
        .withMessage('Shop images must be an array')
];

const shopGetValidator = [
    body('shopId')
        .notEmpty()
        .withMessage('Shop ID is required')
        .isUUID()
        .withMessage('Invalid shop ID')
];

const addUserValidator = [
    body('shopId')
        .notEmpty()
        .withMessage('Shop ID is required')
        .isUUID()
        .withMessage('Invalid shop ID'),
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email address')
        .normalizeEmail(),
    body('role')
        .isIn(['admin', 'staff'])
        .withMessage('Role must be either admin or staff')
];

const removeUserValidator = [
    body('shopId')
        .notEmpty()
        .withMessage('Shop ID is required')
        .isUUID()
        .withMessage('Invalid shop ID'),
    body('userId')
        .notEmpty()
        .withMessage('User ID is required')
        .isUUID()
        .withMessage('Invalid user ID')
];

const updateRoleValidator = [
    body('shopId')
        .notEmpty()
        .withMessage('Shop ID is required')
        .isUUID()
        .withMessage('Invalid shop ID'),
    body('userId')
        .notEmpty()
        .withMessage('User ID is required')
        .isUUID()
        .withMessage('Invalid user ID'),
    body('role')
        .isIn(['admin', 'staff'])
        .withMessage('Role must be either admin or staff')
];

const tenantValidateValidator = [
    param('tenantId')
        .notEmpty()
        .withMessage('Tenant ID is required')
        .isUUID()
        .withMessage('Invalid tenant ID')
];

const tenantShopValidateValidator = [
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

const shopBusinessInfoValidator = [
    body('shopName')
        .optional()
        .trim(),
    body('address')
        .optional()
        .trim(),
    body('phone')
        .optional()
        .trim(),
    body('openingHours')
        .optional()
        .trim(),
    body('deliveryAreas')
        .optional()
        .isArray()
        .withMessage('Delivery areas must be an array'),
    body('deliveryAreas.*')
        .optional()
        .isString()
        .trim(),
    body('paymentMethods')
        .optional()
        .isArray()
        .withMessage('Payment methods must be an array'),
    body('paymentMethods.*')
        .optional()
        .isString()
        .trim()
];

module.exports = {
    shopCreateValidator,
    shopUpdateValidator,
    shopGetValidator,
    addUserValidator,
    removeUserValidator,
    updateRoleValidator,
    tenantValidateValidator,
    tenantShopValidateValidator,
    shopBusinessInfoValidator
};
