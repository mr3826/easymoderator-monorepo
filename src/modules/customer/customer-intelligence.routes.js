/**
 * Customer Intelligence Routes
 * 
 * Endpoints for customer profile analysis, CLV, personalization, and churn risk
 * All routes require authentication
 * 
 * @file customer/customer-intelligence.routes.js
 */

const express = require('express');
const customerIntelligenceController = require('./customer-intelligence.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// ─── All customer intelligence routes require authentication ────────────────
router.use(authenticate);

// ─── Analytics routes MUST come before /:customerId routes ────────────────
// Express matches routes in registration order. /analytics/segments would be
// caught by /:customerId if registered after parameterized routes.

/**
 * GET /analytics/segments
 * Get customer segment distribution across all customers for this shop
 * 
 * Response: { segments: { vip: count, loyal: count, atRisk: count, dormant: count, new: count, regular: count } }
 */
router.get(
    '/analytics/segments',
    customerIntelligenceController.getSegmentAnalytics
);

/**
 * GET /analytics/churn-risk
 * Get customers at risk of churning (churn risk score > 70)
 * 
 * Response: { customers: [{ id, name, email, churnRisk, segment, clv }], totalAtRisk: number }
 */
router.get(
    '/analytics/churn-risk',
    customerIntelligenceController.getChurnRiskAnalytics
);

// ─── Customer-specific routes (must come after /analytics routes) ──────────

/**
 * GET /:customerId/profile
 * Get customer profile with CLV, purchase history, segment, churn risk
 * 
 * Response: { customerId, name, email, clv, purchaseCount, lastPurchaseDate, segment, churnRisk }
 */
router.get(
    '/:customerId/profile',
    customerIntelligenceController.getCustomerProfile
);

/**
 * GET /:customerId/personalization
 * Get AI personalization tips and recent data for this customer
 * 
 * Response: { tips: [{ tip, context }], recentPurchases, preferences }
 */
router.get(
    '/:customerId/personalization',
    customerIntelligenceController.getPersonalizationTips
);

/**
 * POST /:customerId/refresh
 * Refresh and recalculate customer profile intelligence
 * 
 * Response: { customerId, profile: { clv, segment, churnRisk, metrics... } }
 */
router.post(
    '/:customerId/refresh',
    customerIntelligenceController.refreshCustomerProfile
);

module.exports = router;
