const express = require('express');
const router = express.Router();
const conversationController = require('./conversation.controller');
const supportController = require('src/modules/support/support.controller');
const webhookController = require('src/modules/webhook/webhook.controller');
const conversationValidator = require('./conversation.validator');
const { validate } = require('../helpers');
const { authenticate } = require('src/middleware/auth.middleware');

// All conversation routes require authentication
router.use(authenticate);

// Routes for conversations
router.get(
    '/',
    validate(conversationValidator.getConversations),
    conversationController.getConversations
);

router.get(
    '/history',
    conversationController.getHistory
);

router.post(
    '/messages/check-duplicate',
    conversationController.checkDuplicate
);

router.post('/webhooks/validate', webhookController.validateWebhook);
router.post('/webhooks/send', webhookController.sendWebhookMessage);
router.post('/webhooks/retry', webhookController.retryWebhookMessage);

router.post(
    '/',
    validate(conversationValidator.createConversation),
    conversationController.createConversation
);

router.get(
    '/:conversationId',
    conversationController.getConversationById
);

router.put(
    '/:conversationId/status',
    validate(conversationValidator.updateConversationStatus),
    conversationController.updateConversationStatus
);

// Routes for messages within a conversation
router.get(
    '/:conversationId/messages',
    validate(conversationValidator.getMessages),
    conversationController.getMessages
);

router.post(
    '/:conversationId/messages',
    validate(conversationValidator.createMessage),
    conversationController.createMessage
);

// Support ticket endpoints
router.post('/support-tickets', supportController.createTicket);
router.get('/support-tickets/:ticketId', supportController.getTicket);
router.post('/support-tickets/:ticketId/notify-agents', supportController.notifyAgents);

module.exports = router;