/**
 * Customer Intelligence API Controller
 * 
 * Handler functions for customer profile, CLV, personalization, and churn risk analytics
 * 
 * @file customer/customer-intelligence.controller.js
 */

const customerIntelligenceService = require('./customer-intelligence.service');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('CustomerIntelligenceController');

/**
 * GET /:customerId/profile
 * Get customer profile with intelligence metrics
 * 
 * Includes: CLV, purchase history, segment, churn risk, engagement stats
 */
async function getCustomerProfile(req, res, next) {
  try {
    const shopId = req.user.shopId;
    const { customerId } = req.params;

    const profile = await customerIntelligenceService.getCustomerProfile(customerId, shopId);

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /:customerId/personalization
 * Get personalization data for AI responses
 * 
 * Used by AI service to write personalized messages
 */
async function getPersonalizationTips(req, res, next) {
  try {
    const shopId = req.user.shopId;
    const { customerId } = req.params;

    const personalizationData = await customerIntelligenceService.getPersonalizationData(customerId, shopId);

    res.status(200).json({
      success: true,
      data: personalizationData
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /:customerId/refresh
 * Recalculate customer profile metrics
 * 
 * Normally called periodically, but can be triggered manually
 */
async function refreshCustomerProfile(req, res, next) {
  try {
    const shopId = req.user.shopId;
    const { customerId } = req.params;

    const profile = await customerIntelligenceService.updateCustomerProfile(customerId, shopId);

    res.status(200).json({
      success: true,
      data: profile,
      message: 'Customer profile refreshed'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /analytics/segments
 * Get customer segment distribution (analytics endpoint)
 * 
 * Shows: number and % of customers in each segment (VIP, loyal, at-risk, etc.)
 */
async function getSegmentAnalytics(req, res, next) {
  try {
    const shopId = req.user.shopId;

    const distribution = await customerIntelligenceService.getSegmentDistribution(shopId);

    res.status(200).json({
      success: true,
      data: distribution
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /analytics/churn-risk
 * Get customers at risk of churning (churn risk score > 70)
 * 
 * Returns list of customers flagged for potential churn with risk details
 */
async function getChurnRiskAnalytics(req, res, next) {
  try {
    const shopId = req.user.shopId;

    const churnRiskData = await customerIntelligenceService.getChurnRiskCustomers(shopId);

    res.status(200).json({
      success: true,
      data: churnRiskData
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCustomerProfile,
  getPersonalizationTips,
  refreshCustomerProfile,
  getSegmentAnalytics,
  getChurnRiskAnalytics
};
