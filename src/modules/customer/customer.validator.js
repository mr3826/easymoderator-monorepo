const { body, query } = require('express-validator');

/**
 * Validator for creating a customer
 */
const createCustomerValidator = [
    body('name')
        .trim()
        .notEmpty()
        .withMessage('Customer name is required')
        .isLength({ max: 255 })
        .withMessage('Customer name must not exceed 255 characters'),

    body('email')
        .optional()
        .trim()
        .isEmail()
        .withMessage('Email must be a valid email address')
        .isLength({ max: 255 })
        .withMessage('Email must not exceed 255 characters'),

    body('number')
        .trim()
        .notEmpty()
        .withMessage('Phone number is required')
        .isLength({ max: 50 })
        .withMessage('Phone number must not exceed 50 characters'),

    body('channel')
        .trim()
        .notEmpty()
        .withMessage('Channel is required')
        .isIn(['facebook', 'whatsapp', 'telegram', 'webchat', 'manual'])
        .withMessage('Channel must be one of: facebook, whatsapp, telegram, webchat, manual')
];

/**
 * Validator for updating a customer
 */
const updateCustomerValidator = [
    body('customerId')
        .trim()
        .notEmpty()
        .withMessage('Customer ID is required')
        .isUUID()
        .withMessage('Customer ID must be a valid UUID'),

    body('name')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Customer name cannot be empty')
        .isLength({ max: 255 })
        .withMessage('Customer name must not exceed 255 characters'),

    body('email')
        .optional()
        .trim()
        .isEmail()
        .withMessage('Email must be a valid email address')
        .isLength({ max: 255 })
        .withMessage('Email must not exceed 255 characters'),

    body('number')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Phone number cannot be empty')
        .isLength({ max: 50 })
        .withMessage('Phone number must not exceed 50 characters'),

    body('channel')
        .optional()
        .trim()
        .isIn(['facebook', 'whatsapp', 'telegram', 'webchat', 'manual'])
        .withMessage('Channel must be one of: facebook, whatsapp, telegram, webchat, manual')
];

/**
 * Validator for getting a single customer
 */
const getCustomerValidator = [
    query('customerId')
        .trim()
        .notEmpty()
        .withMessage('Customer ID is required')
        .isUUID()
        .withMessage('Customer ID must be a valid UUID')
];

/**
 * Validator for listing customers with filters
 */
const listCustomersValidator = [
    query('search')
        .optional()
        .trim(),

    query('email')
        .optional()
        .trim(),

    query('number')
        .optional()
        .trim(),

    query('channel')
        .optional()
        .isIn(['facebook', 'whatsapp', 'telegram', 'webchat', 'manual'])
        .withMessage('Channel must be one of: facebook, whatsapp, telegram, webchat, manual'),

    query('start_date')
        .optional()
        .isISO8601()
        .withMessage('Start date must be a valid ISO 8601 date'),

    query('end_date')
        .optional()
        .isISO8601()
        .withMessage('End date must be a valid ISO 8601 date')
];

module.exports = {
    createCustomerValidator,
    updateCustomerValidator,
    getCustomerValidator,
    listCustomersValidator
};
