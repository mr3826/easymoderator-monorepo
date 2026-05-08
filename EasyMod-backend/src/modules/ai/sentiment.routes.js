/**
 * Sentiment Analysis Routes
 *
 * Base path: /api/sentiment
 * All endpoints require authentication.
 */

const express = require('express');
const sentimentController = require('./sentiment.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

/**
 * POST /api/sentiment/analyze
 * Body: { text: string, conversationId?: string }
 * Returns: { success: true, data: { sentiment, confidence, shouldEscalate, method } }
 */
router.post('/analyze', sentimentController.analyze);

module.exports = router;
