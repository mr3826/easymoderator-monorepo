const express = require('express');
const { body } = require('express-validator');
const AnalyticsController = require('./analytics.controller');

const router = express.Router();

// Validation middleware
const validateKnowledgeGap = [
    body('question').notEmpty().withMessage('question is required'),
    body('shop_id').notEmpty().withMessage('shop_id is required'),
    body('platform').isIn(['messenger', 'instagram', 'whatsapp']).withMessage('Invalid platform'),
    body('language').optional().isIn(['en', 'bn', 'mixed']).withMessage('Invalid language')
];

// Routes

/**
 * POST /api/analytics/knowledge-gap
 * Log knowledge gaps when FAQ handler can't answer
 */
router.post('/knowledge-gap', validateKnowledgeGap, AnalyticsController.logKnowledgeGap);

module.exports = router;
