const express = require('express');
const { body } = require('express-validator');
const NotificationController = require('./notification.controller');
const pushSubscriptionRoutes = require('./push-subscription.routes');

const router = express.Router();

// Push subscription management (register / unregister device tokens)
router.use(pushSubscriptionRoutes);

// Validation middleware
const validateMarkHandoff = [
    body('shop_id').notEmpty().withMessage('shop_id is required'),
    body('customer_id').notEmpty().withMessage('customer_id is required'),
    body('platform').isIn(['messenger', 'instagram']).withMessage('Invalid platform'),
    body('trigger_reason').notEmpty().withMessage('trigger_reason is required'),
    body('confidence_score').isInt({ min: 0, max: 100 }).withMessage('confidence_score must be 0-100'),
    body('last_message').optional().isString()
];

const validatePushNotification = [
    body('shop_id').notEmpty().withMessage('shop_id is required'),
    body('type').notEmpty().withMessage('type is required'),
    body('title').notEmpty().withMessage('title is required'),
    body('body').notEmpty().withMessage('body is required'),
    body('data').optional().isObject()
];

// Routes

/**
 * POST /api/notifications/mark-handoff
 * Mark conversation as needing human intervention
 */
router.post('/mark-handoff', validateMarkHandoff, NotificationController.markHandoff);

/**
 * POST /api/notifications/push
 * Send push notification to shop owner
 */
router.post('/push', validatePushNotification, NotificationController.sendPush);

module.exports = router;
