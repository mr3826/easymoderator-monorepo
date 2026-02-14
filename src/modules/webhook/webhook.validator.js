const { body, param } = require('express-validator');

const registerWebhookValidator = [
    body('url')
        .notEmpty()
        .withMessage('URL is required')
        .isURL()
        .withMessage('Must be a valid URL'),
    body('events')
        .isArray({ min: 1 })
        .withMessage('Events array is required and must have at least one event'),
    body('events.*')
        .isIn([
            'order.created', 'order.updated', 'order.cancelled',
            'customer.created', 'customer.updated', 
            'product.created', 'product.updated', 'product.deleted',
            'payment.completed', 'payment.failed',
            'subscription.created', 'subscription.updated', 'subscription.cancelled'
        ])
        .withMessage('Invalid event type'),
    body('secret')
        .optional()
        .isLength({ min: 16 })
        .withMessage('Secret must be at least 16 characters'),
    body('description')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Description must be less than 500 characters'),
    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean')
];

const updateWebhookValidator = [
    param('webhookId')
        .notEmpty()
        .withMessage('Webhook ID is required')
        .isUUID()
        .withMessage('Invalid webhook ID'),
    body('url')
        .optional()
        .isURL()
        .withMessage('Must be a valid URL'),
    body('events')
        .optional()
        .isArray({ min: 1 })
        .withMessage('Events must be an array with at least one event'),
    body('events.*')
        .optional()
        .isIn([
            'order.created', 'order.updated', 'order.cancelled',
            'customer.created', 'customer.updated', 
            'product.created', 'product.updated', 'product.deleted',
            'payment.completed', 'payment.failed',
            'subscription.created', 'subscription.updated', 'subscription.cancelled'
        ])
        .withMessage('Invalid event type'),
    body('secret')
        .optional()
        .isLength({ min: 16 })
        .withMessage('Secret must be at least 16 characters'),
    body('description')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Description must be less than 500 characters'),
    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean')
];

const deleteWebhookValidator = [
    param('webhookId')
        .notEmpty()
        .withMessage('Webhook ID is required')
        .isUUID()
        .withMessage('Invalid webhook ID')
];

module.exports = {
    registerWebhookValidator,
    updateWebhookValidator,
    deleteWebhookValidator
};