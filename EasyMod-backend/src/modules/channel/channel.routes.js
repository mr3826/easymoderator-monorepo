const express = require('express');
const channelController = require('./channel.controller');
const channelOAuthController = require('./channel.oauth.controller');
const channelValidator = require('./channel.validator');
const { validate } = require('../helpers');
const { authenticate } = require('../../middleware/auth.middleware');
const { idempotencyMiddleware, storeIdempotencyResult } = require('../audit/idempotency.middleware');
const { auditLogMiddleware } = require('../audit/audit.middleware');

const router = express.Router();

// All channel routes require authentication
router.use(authenticate);

// ── Meta OAuth routes ────────────────────────────────────────────────────────
// IMPORTANT: These must be declared BEFORE router.get('/:id', ...) to prevent
// the string "oauth" from being matched as a UUID path parameter.
router.post('/oauth/initiate',
  validate(channelValidator.initiateOAuth),
  channelOAuthController.initiateOAuth
);
router.post('/oauth/callback',
  validate(channelValidator.oauthCallback),
  channelOAuthController.handleOAuthCallback
);
router.post('/oauth/connect-page',
  validate(channelValidator.connectOAuthPage),
  channelOAuthController.connectOAuthPage
);

// Debug routes (must be before /:id to avoid route collision)
router.get('/debug/page-id/:pageId', channelController.debugChannelByPageId);

// RESTful routes
router.get('/', validate(channelValidator.getChannels), channelController.getChannels);
router.get('/config/:channelType', channelController.getChannelConfig);
// Bug #10: full config endpoint — connection status + AI behaviour in one shot
router.get('/:id/full-config', channelController.getChannelFullConfig);
router.get('/:id', validate(channelValidator.getChannelById), channelController.getChannelById);
router.post('/connect', validate(channelValidator.connectChannel), channelController.connectChannelByType);
router.post('/:id/disconnect', validate(channelValidator.disconnectChannel), channelController.disconnectChannelById);
router.post('/',
    idempotencyMiddleware,
    validate(channelValidator.createChannel),
    channelController.createChannelRest,
    storeIdempotencyResult(201),
    auditLogMiddleware('CREATE', 'CHANNEL')
);
router.patch('/:id',
    idempotencyMiddleware,
    validate(channelValidator.updateChannel),
    channelController.updateChannelById,
    storeIdempotencyResult(200),
    auditLogMiddleware('UPDATE', 'CHANNEL')
);
router.delete('/:id',
    idempotencyMiddleware,
    validate(channelValidator.deleteChannel),
    channelController.deleteChannelById,
    storeIdempotencyResult(200),
    auditLogMiddleware('DELETE', 'CHANNEL')
);

// Admin: Manually subscribe channel to Meta webhooks (for manual page_id updates)
router.post('/:id/subscribe-webhooks', channelController.subscribeChannelToWebhooks);

// Test: fire a synthetic message through the full pipeline (no Meta required)
router.post('/:id/test-pipeline', channelController.testChannelPipeline);

// WhatsApp Business API — direct token connect (no OAuth flow needed)
// POST /channel/whatsapp/connect
router.post('/whatsapp/connect', validate(channelValidator.connectWhatsApp), channelController.connectWhatsApp);

// WhatsApp disconnect
// POST /channel/whatsapp/disconnect
router.post('/whatsapp/disconnect', channelController.disconnectWhatsApp);

module.exports = router;
