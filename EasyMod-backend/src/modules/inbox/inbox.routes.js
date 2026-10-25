'use strict';

/**
 * P+03 inbox action queue — read-only, platform-flag gated (action_queue,
 * default OFF). Tenant comes from the verified JWT ONLY.
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { verifyShopAccess } = require('../../middleware/shop-access.middleware');
const actions = require('./inbox-actions.service');
const pilotFeatures = require('../pilot-features/pilot-features.service');

const router = express.Router();

router.use(authenticate, verifyShopAccess);

router.get('/actions', async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        if (!shopId) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' } });
        }
        const enabled = await pilotFeatures.isActionQueueEnabled(shopId);
        if (!enabled) {
            return res.status(409).json({
                success: false,
                error: { code: 'FEATURE_DISABLED', message: 'Action queue is not enabled for this shop' },
            });
        }
        const data = await actions.getInboxActions(shopId, {
            // MW-V1: server-backed built-in views; anything unknown falls back
            // to 'attention' inside the service (no arbitrary filters).
            view: typeof req.query.view === 'string' ? req.query.view : 'attention',
            actorUserId: req.user?.userId || null,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
