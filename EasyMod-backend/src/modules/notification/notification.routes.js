const express = require('express');
const { body } = require('express-validator');
const { param, query, validationResult } = require('express-validator');
const NotificationController = require('./notification.controller');
const pushSubscriptionRoutes = require('./push-subscription.routes');
const telegramNotificationRoutes = require('./telegram-notification.routes');
const { authenticate } = require('../../middleware/auth.middleware');
const { OwnerNotification } = require('../entities');

const router = express.Router();

// Push subscription management (register / unregister device tokens)
router.use(pushSubscriptionRoutes);
router.use('/telegram', telegramNotificationRoutes);

router.get(
    '/in-app',
    authenticate,
    [query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50')],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            const shopId = req.user?.shopId || req.shopId;
            const limit = Number(req.query.limit || 20);
            const notifications = await OwnerNotification.findAll({
                where: { shop_id: shopId },
                order: [['created_at', 'DESC']],
                limit
            });

            res.json({ success: true, data: notifications });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to load notifications' });
        }
    }
);

router.patch(
    '/in-app/:id/read',
    authenticate,
    [param('id').isUUID().withMessage('id must be a UUID')],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            const shopId = req.user?.shopId || req.shopId;
            const [updated] = await OwnerNotification.update(
                { status: 'completed', responded_at: new Date() },
                { where: { id: req.params.id, shop_id: shopId } }
            );

            if (!updated) {
                return res.status(404).json({ success: false, error: 'Notification not found' });
            }

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to update notification' });
        }
    }
);

// Validation middleware
const validateMarkHandoff = [
    body('shop_id').notEmpty().withMessage('shop_id is required'),
    body('customer_id').notEmpty().withMessage('customer_id is required'),
    body('platform').isIn(['messenger']).withMessage('Invalid platform'),
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
