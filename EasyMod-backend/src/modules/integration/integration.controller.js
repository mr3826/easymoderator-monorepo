/**
 * Integration Features API Controller
 * 
 * Endpoints for inventory sync, comment-to-DM, and related integrations
 * 
 * @file integration/integration.controller.js
 */

const { Router } = require('express');
const { authenticate: auth } = require('../../middleware/auth.middleware');
const commentToDMService = require('./comment-to-dm.service');
const inventorySyncService = require('./inventory-sync.service');
const productSyncService = require('./inventory-sync-product.service');
const productSyncRouter = require('./inventory-sync-product.controller');
const { AppError } = require('../../utils/AppError');

const router = Router();

// Mount product sync routes
router.use('/products', productSyncRouter);

/**
 * ===== Comment-to-DM Automation =====
 */

/**
 * GET /integration/comment-to-dm/config
 * Get comment-to-DM configuration for the shop
 */
router.get('/comment-to-dm/config', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const config = await commentToDMService.getCommentToDMConfig(shopId);

    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /integration/comment-to-dm/config
 * Update comment-to-DM configuration
 * 
 * Body: { enabled: boolean, welcomeTemplate: string }
 */
router.put('/comment-to-dm/config', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { enabled, welcomeTemplate } = req.body;

    const result = await commentToDOMService.configureCommentToDM(shopId, {
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
 * POST /integration/comment-to-dm/webhook
 * Webhook endpoint for Meta comment events
 * Called by Meta when someone comments on page
 */
router.post('/comment-to-dm/webhook', async (req, res, next) => {
  try {
    const { entry } = req.body;
    const shopId = req.headers['x-shop-id']; // Must be in header

    if (!shopId) {
      return res.status(400).json({ error: 'x-shop-id header required' });
    }

    const result = await commentToDMService.processCommentWebhook(req.body, shopId);

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * ===== Inventory Sync =====
 */

/**
 * GET /integration/inventory-sync/config
 * Get current inventory sync configuration for shop
 */
router.get('/inventory-sync/config', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const configs = await inventorySyncService.getInventorySyncConfig(shopId);

    res.status(200).json({
      success: true,
      data: configs,
      count: configs.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /integration/inventory-sync/setup
 * Configure inventory sync for a new provider
 * 
 * Body: { provider: 'shopify'|'woocommerce'|'google_sheets', credentials: {...}, config: {...} }
 */
router.post('/inventory-sync/setup', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { provider, credentials, config } = req.body;

    if (!provider || !credentials) {
      return res.status(400).json({
        success: false,
        error: 'provider and credentials required'
      });
    }

    const result = await inventorySyncService.saveInventorySyncConfig(
      shopId,
      provider,
      credentials,
      config || {}
    );

    res.status(201).json({
      success: true,
      data: result,
      message: `${provider} inventory sync configured`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /integration/inventory-sync/execute
 * Manually trigger inventory sync
 * 
 * Optional query: ?provider=shopify (sync only one provider, or all if not specified)
 */
router.post('/inventory-sync/execute', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { provider } = req.query;

    const result = await inventorySyncService.executeInventorySync(shopId, provider);

    res.status(200).json({
      success: result.success,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /integration/inventory-sync/disable
 * Disable inventory sync (optionally for specific provider)
 * 
 * Query: ?provider=shopify (optional)
 */
router.delete('/inventory-sync/disable', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { provider } = req.query;

    const result = await inventorySyncService.disableInventorySync(shopId, provider);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
