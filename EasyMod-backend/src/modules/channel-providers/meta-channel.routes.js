/**
 * meta-channel.routes.js
 *
 * Canonical Meta channel + OAuth router. Mounted at /api/channels/meta.
 *
 * Routes:
 *   POST   /api/channels/meta/oauth/initiate
 *   POST   /api/channels/meta/oauth/callback
 *   POST   /api/channels/meta/oauth/connect-asset
 *   GET    /api/channels/meta
 *   POST   /api/channels/meta/:channelId/disconnect
 *   POST   /api/channels/meta/:channelId/reconnect
 *   POST   /api/channels/meta/:channelId/test-webhook
 *
 * The OAuth sub-routes MUST be declared before the `/:channelId/...` group so
 * Express does not try to interpret "oauth" as a UUID param.
 */

'use strict';

const express = require('express');
const oauthController = require('./meta-oauth.controller');
const channelController = require('./meta-channel.controller');
const v = require('./meta-oauth.validator');
const { validate } = require('../helpers');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

// ── OAuth (declared first to avoid /:channelId collision) ──────────────────
router.post('/oauth/initiate', validate(v.initiate), oauthController.initiate);
router.post('/oauth/callback', validate(v.callback), oauthController.callback);
router.post('/oauth/connect-asset', validate(v.connectAsset), oauthController.connectAsset);

// ── Channel lifecycle ─────────────────────────────────────────────────────
router.get('/', channelController.list);
router.post(
    '/:channelId/disconnect',
    validate(v.channelIdParam),
    channelController.disconnect
);
router.post(
    '/:channelId/reconnect',
    validate(v.channelIdParam),
    channelController.reconnect
);
router.post(
    '/:channelId/test-webhook',
    validate(v.channelIdParam),
    channelController.testWebhook
);
router.get(
    '/:channelId/consent-summary',
    validate(v.channelIdParam),
    channelController.consentSummary
);

module.exports = router;
