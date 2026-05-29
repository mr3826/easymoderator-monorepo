const { body, param } = require('express-validator');

const shopCreateValidator = [
    body('shop_name')
        .trim()
        .notEmpty().withMessage('Shop name is required')
        .isLength({ min: 2, max: 100 }).withMessage('Shop name must be 2–100 characters'),
    body('phone')
        .optional()
        .trim()
        .matches(/^01[3-9]\d{8}$/).withMessage('Phone must be a valid Bangladeshi mobile number (e.g. 01712345678)'),
    body('address')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('Address must not exceed 500 characters'),
    body('shop_type')
        .optional()
        .isIn(['retail', 'wholesale', 'f-commerce', 'service', 'other'])
        .withMessage('shop_type must be one of: retail, wholesale, f-commerce, service, other')
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
    shopBusinessInfoValidator
};
