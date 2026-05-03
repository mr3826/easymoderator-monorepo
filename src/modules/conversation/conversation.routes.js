const express = require('express');
const router = express.Router();
const conversationController = require('./conversation.controller');
const conversationValidator = require('./conversation.validator');
const { validate } = require('../helpers');
const { authenticate, checkSubscriptionStatus } = require('../../middleware/auth.middleware');

// All conversation routes require authentication + active subscription
router.use(authenticate);
router.use(checkSubscriptionStatus);

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

// SSE stream — must be before /:conversationId to avoid param capture
router.get(
    '/events',
    conversationController.getEventStream
);

// Bug #2: full-history search — must be before /:conversationId
router.get('/search', conversationController.searchConversations);

// B3: Bulk status update — must be before /:conversationId to avoid param capture
router.patch('/bulk-status', conversationController.bulkUpdateStatus);

router.post(
    '/messages/check-duplicate',
    conversationController.checkDuplicate
);

router.post(
    '/',
    validate(conversationValidator.createConversation),
    conversationController.createConversation
);

router.get(
    '/:conversationId',
    conversationController.getConversationById
);

router.patch(
    '/:conversationId',
    validate(conversationValidator.updateConversation),
    conversationController.updateConversation
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

module.exports = router;
