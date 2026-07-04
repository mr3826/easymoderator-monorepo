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
        const shopId = req.shopId || req.user?.shopId;
        const userId = req.userId || req.user?.userId;

        try {
            // Upsert: if the device_token / endpoint already exists for this shop,
            // just update it rather than creating a duplicate row.
            const uniqueKey = type === 'web'
                ? subscription_json?.endpoint
                : device_token;

            if (!uniqueKey) {
                return res.status(400).json({ success: false, error: 'Missing subscription identifier' });
            }

            // Find existing subscription for this shop+type+identifier. Web push
            // endpoints are stored inside JSONB, so compare them in JS after
            // constraining by shop/type.
            let existing = null;
            if (type === 'web') {
                const webSubscriptions = await PushSubscription.findAll({
                    where: { shop_id: shopId, type }
                });
                existing = webSubscriptions.find((sub) => sub.subscription_json?.endpoint === uniqueKey) || null;
            } else {
                existing = await PushSubscription.findOne({
                    where: { shop_id: shopId, type, device_token: uniqueKey }
                });
            }

            let sub;
            if (existing) {
                await existing.update({
                    user_id: userId,
                    subscription_json: type === 'web' ? subscription_json : null,
                    device_token: type === 'fcm' ? device_token : null
                });
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

        const shopId = req.shopId || req.user?.shopId;
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
