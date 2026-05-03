const express = require('express');
const { body } = require('express-validator');
const AnalyticsController = require('./analytics.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// Validation middleware
const validateKnowledgeGap = [
    body('question').notEmpty().withMessage('question is required'),
    body('shop_id').notEmpty().withMessage('shop_id is required'),
    body('platform').isIn(['messenger', 'instagram']).withMessage('Invalid platform'),
    body('language').optional().isIn(['en', 'bn', 'mixed']).withMessage('Invalid language')
];

// Routes

/**
 * POST /api/analytics/knowledge-gap
 * Log knowledge gaps when FAQ handler can't answer
 */
router.post('/knowledge-gap', validateKnowledgeGap, AnalyticsController.logKnowledgeGap);

// GET /api/analytics/knowledge-gap — authenticated, scoped to the logged-in shop
router.get('/knowledge-gap', authenticate, AnalyticsController.getKnowledgeGaps);

// GET /api/analytics/top-unanswered — top unanswered questions
router.get('/top-unanswered', authenticate, AnalyticsController.getTopUnansweredQuestions);

// GET /api/analytics/peak-hours — message volume by hour of day
router.get('/peak-hours', authenticate, AnalyticsController.getPeakHours);

// GET /api/analytics/intent-breakdown — conversation count by intent
router.get('/intent-breakdown', authenticate, AnalyticsController.getIntentBreakdown);

// GET /api/analytics/confidence-distribution — AI confidence score buckets
router.get('/confidence-distribution', authenticate, AnalyticsController.getConfidenceDistribution);

module.exports = router;
