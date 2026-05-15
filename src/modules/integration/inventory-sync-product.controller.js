/**
 * Product Inventory Sync API Controller
 * 
 * Endpoints for syncing external inventory sources to app's Product module
 * 
 * @file integration/inventory-sync-product.controller.js
 */

const { Router } = require('express');
const { authenticate: auth } = require('../../middleware/auth.middleware');
const productSyncService = require('./inventory-sync-product.service');

const router = Router();

/**
 * POST /inventory-sync/products/sync
 * Manually trigger product inventory sync
 * 
 * Query params:
 * - provider: 'shopify' | 'woocommerce' | 'google_sheets' (required)
 * 
 * @example
 * POST /inventory-sync/products/sync?provider=shopify
 * 
 * Response:
 * {
 *   "matched": 150,        // Found in app
 *   "updated": 48,         // Actually updated quantity
 *   "unmapped": 12,        // No app product with this SKU
 *   "skipped": 2,          // Exist but tracking disabled
 *   "recommendation": "... fix unmapped items"
 * }
 */
router.post('/products/sync', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { provider } = req.query;

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'provider query parameter required (shopify, woocommerce, or google_sheets)'
      });
    }

    const result = await productSyncService.syncProductInventory(shopId, provider);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /inventory-sync/products/report
 * Get detailed sync report and unmapped items
 * 
 * Query params:
 * - provider: 'shopify' | 'woocommerce' | 'google_sheets' (required)
 * - days: number of days to report (default 7)
 * 
 * @example
 * GET /inventory-sync/products/report?provider=shopify&days=30
 * 
 * Response shows:
 * - updateProducts: count of products updated
 * - unmappedItems: list of external SKUs with no app product
 * - volumeChange: total quantity change
 */
router.get('/products/report', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { provider, days } = req.query;

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'provider query parameter required'
      });
    }

    const report = await productSyncService.getSyncReport(
      shopId,
      provider,
      parseInt(days) || 7
    );

    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
