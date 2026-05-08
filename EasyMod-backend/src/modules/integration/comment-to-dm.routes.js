/**
 * Comment-to-DM Automation Routes
 * 
 * Protected endpoints for configuring and managing comment-to-DM automation.
 * All routes require authentication.
 * 
 * @file integration/comment-to-dm.routes.js
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const commentToDmController = require('./integration.controller');

const router = express.Router();

/**
 * GET /config
 * Get current comment-to-DM webhook configuration for the shop
 * 
 * @auth Required (authenticate middleware)
 * @returns {Object} { enabled, welcomeTemplate, webhookUrl }
 */
router.get('/config', authenticate, async (req, res, next) => {
  try {
    const commentToDmService = require('./comment-to-dm.service');
    const shopId = req.user.shopId;
    
    const config = await commentToDmService.getCommentToDMConfig(shopId);
    
    res.status(200).json({
      success: true,
      data: {
        enabled: config.enabled,
        welcomeTemplate: config.welcomeTemplate,
        webhookUrl: `${process.env.API_BASE_URL || 'https://api.easymod.io'}/webhooks/meta/comment-to-dm`
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /config
 * Save/update comment-to-DM webhook configuration
 * 
 * @auth Required (authenticate middleware)
 * @body {Object} { enabled?: boolean, welcomeTemplate?: string }
 * @returns {Object} { enabled, welcomeTemplate }
 */
router.post('/config', authenticate, async (req, res, next) => {
  try {
    const commentToDmService = require('./comment-to-dm.service');
    const shopId = req.user.shopId;
    const { enabled, welcomeTemplate } = req.body;

    const result = await commentToDmService.configureCommentToDM(shopId, {
      enabled,
      welcomeTemplate
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /enable
 * Enable comment-to-DM automation for this shop
 * 
 * @auth Required (authenticate middleware)
 * @returns {Object} { success: true, message: "Comment-to-DM enabled" }
 */
router.post('/enable', authenticate, async (req, res, next) => {
  try {
    const commentToDmService = require('./comment-to-dm.service');
    const shopId = req.user.shopId;

    const result = await commentToDmService.configureCommentToDM(shopId, {
      enabled: true
    });

    res.status(200).json({
      success: true,
      message: 'Comment-to-DM automation enabled',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /disable
 * Disable comment-to-DM automation for this shop
 * 
 * @auth Required (authenticate middleware)
 * @returns {Object} { success: true, message: "Comment-to-DM disabled" }
 */
router.post('/disable', authenticate, async (req, res, next) => {
  try {
    const commentToDmService = require('./comment-to-dm.service');
    const shopId = req.user.shopId;

    const result = await commentToDmService.configureCommentToDM(shopId, {
      enabled: false
    });

    res.status(200).json({
      success: true,
      message: 'Comment-to-DM automation disabled',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats
 * Get comment-to-DM automation statistics for the shop
 * 
 * @auth Required (authenticate middleware)
 * @returns {Object} { totalComments, totalConversions, totalDmsSent, lastSync }
 */
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const { Conversation, Message } = require('../entities');
    const shopId = req.user.shopId;

    // Get count of conversations sourced from comment-to-DM
    const commentToDmConversations = await Conversation.findAll({
      where: { shop_id: shopId },
      attributes: ['id'],
      raw: true,
      limit: 1000 // Large limit to get accurate count
    });

    // Count total and successful conversions
    const conversationIds = commentToDmConversations
      .filter(c => c.metadata?.source === 'facebook_comment')
      .map(c => c.id);

    const totalConversationsFromComments = conversationIds.length;

    // Count total DMs sent via comment-to-DM
    const dmMessages = await Message.findAll({
      where: { 
        conversation_id: conversationIds,
        sender: 'bot'
      },
      attributes: ['id'],
      raw: true
    });

    const totalDmsSent = dmMessages.length;

    res.status(200).json({
      success: true,
      data: {
        totalCommentToConversions: totalConversationsFromComments,
        totalDmsSent,
        lastSync: new Date().toISOString(),
        period: 'all_time'
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
