const express = require('express');
const webhookController = require('./webhook.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validateRequest } = require('../../middleware/validate-request.middleware');
const webhookValidator = require('./webhook.validator');

const router = express.Router();

// Webhook registration endpoints require authentication
router.use(authenticate);

// POST /webhook/register - Register webhook endpoint
router.post('/register',
    validateRequest(webhookValidator.registerWebhookValidator),
    webhookController.registerWebhook
);

// GET /webhook/list - Get registered webhooks
router.get('/list', webhookController.getWebhooks);

// PUT /webhook/:webhookId - Update webhook
router.put('/:webhookId',
    validateRequest(webhookValidator.updateWebhookValidator),
    webhookController.updateWebhook
);

// DELETE /webhook/:webhookId - Delete webhook
router.delete('/:webhookId',
    validateRequest(webhookValidator.deleteWebhookValidator),
    webhookController.deleteWebhook
);

// POST /webhook/:webhookId/test - Test webhook
router.post('/:webhookId/test',
    validateRequest(webhookValidator.deleteWebhookValidator),
    webhookController.testWebhook
);

// GET /webhook/:webhookId/logs - Get webhook delivery logs
router.get('/:webhookId/logs',
    validateRequest(webhookValidator.deleteWebhookValidator),
    webhookController.getWebhookLogs
);

module.exports = router;
