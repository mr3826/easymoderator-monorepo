const express = require('express');
const { body, validationResult } = require('express-validator');
const AIChatbotController = require('./ai-chatbot.controller');

const router = express.Router();

// Validation middleware
const validateProcessMessage = [
  body('shop_id')
    .trim().notEmpty().withMessage('shop_id is required')
    .isUUID().withMessage('shop_id must be a valid UUID'),
  body('customer_channel_id')
    .trim().notEmpty().withMessage('customer_channel_id is required')
    .isLength({ max: 100 }).withMessage('customer_channel_id must not exceed 100 characters'),
  body('platform')
    .trim().notEmpty().withMessage('platform is required')
    .isIn(['facebook', 'instagram'])
    .withMessage('platform must be one of: facebook, instagram'),
  body('message')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 4000 }).withMessage('message must not exceed 4000 characters')
    .customSanitizer(v => typeof v === 'string'
      ? v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      : v),
  body('message_id')
    .optional()
    .trim()
    .isLength({ max: 255 }),
  body('sender_info')
    .optional()
    .isObject().withMessage('sender_info must be an object'),
  body('attachments')
    .optional()
    .isArray().withMessage('attachments must be an array')
];

const validateMarkHandoff = [
    body('reason').notEmpty().withMessage('reason is required'),
    body('metadata').optional().isObject()
];

// Routes

/**
 * POST /api/ai-chatbot/process
 * Main endpoint for processing incoming messages and generating AI responses
 */
router.post('/process', validateProcessMessage, AIChatbotController.processMessage);

/**
 * GET /api/ai-chatbot/context/:conversation_id
 * Get conversation context for LLM or debugging
 */
router.get('/context/:conversation_id', AIChatbotController.getConversationContext);

/**
 * POST /api/ai-chatbot/handoff/:conversation_id
 * Mark conversation for human handoff
 */
router.post('/handoff/:conversation_id', validateMarkHandoff, AIChatbotController.markForHumanHandoff);

module.exports = router;
