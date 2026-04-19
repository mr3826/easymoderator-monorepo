const express = require('express');
const { body, param } = require('express-validator');
const { validationResult } = require('express-validator');
const { PushSubscription } = require('../entities');
const { authenticate } = require('../../middleware/auth.middleware');
const { createLogger } = require('../../utils/structured-logger');

const router = express.Router();
const logger = createLogger('PushSubscription');

/**
 * POST /api/notifications/subscriptions
 * Register a web-push subscription or FCM device token for the current shop.
 */
router.post(
    '/subscriptions',
    authenticate,
    [
        body('type').isIn(['web', 'fcm']).withMessage('type must be web or fcm'),
        body('subscription_json')
            .if(body('type').equals('web'))
            .notEmpty().withMessage('subscription_json required for web push'),
        body('device_token')
            .if(body('type').equals('fcm'))
            .notEmpty().withMessage('device_token required for FCM push')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { type, subscription_json, device_token } = req.body;
        const shopId = req.shopId;
        const userId = req.userId;

        try {
            // Upsert: if the device_token / endpoint already exists for this shop,
            // just update it rather than creating a duplicate row.
            const uniqueKey = type === 'web'
                ? subscription_json?.endpoint
                : device_token;

            if (!uniqueKey) {
                return res.status(400).json({ success: false, error: 'Missing subscription identifier' });
            }

            // Find existing subscription for this shop+type+identifier
            const existing = await PushSubscription.findOne({
                where: {
                    shop_id: shopId,
                    type,
                    ...(type === 'web'
                        ? {}  // JSONB endpoint matching done below
                        : { device_token: uniqueKey })
                }
            });

            let sub;
            if (existing && type === 'fcm') {
                await existing.update({ user_id: userId, device_token });
                sub = existing;
            } else {
                sub = await PushSubscription.create({
                    shop_id: shopId,
                    user_id: userId,
                    type,
                    subscription_json: type === 'web' ? subscription_json : null,
                    device_token: type === 'fcm' ? device_token : null
                });
            }

            logger.info('Push subscription registered', { shopId, type, id: sub.id });
            return res.status(201).json({ success: true, id: sub.id });
        } catch (err) {
            logger.error('Failed to register push subscription', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to register subscription' });
        }
    }
);

/**
 * DELETE /api/notifications/subscriptions/:id
 * Unregister a push subscription.
 */
router.delete(
    '/subscriptions/:id',
    authenticate,
    [param('id').isUUID().withMessage('id must be a UUID')],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const shopId = req.shopId;
        try {
            const deleted = await PushSubscription.destroy({
                where: { id: req.params.id, shop_id: shopId }
            });

            if (!deleted) {
                return res.status(404).json({ success: false, error: 'Subscription not found' });
            }

            logger.info('Push subscription removed', { id: req.params.id, shopId });
            return res.json({ success: true });
        } catch (err) {
            logger.error('Failed to remove push subscription', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to remove subscription' });
        }
    }
);

module.exports = router;
