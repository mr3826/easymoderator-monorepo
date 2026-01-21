const express = require('express');
const router = express.Router();
const conversationController = require('./conversation.controller');
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

module.exports = router;