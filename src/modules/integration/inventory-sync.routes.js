const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const productSyncService = require('./inventory-sync-product.service');

const router = express.Router();

/**
 * POST /api/inventory-sync/sync
 * Manually trigger product inventory sync from external source
 * 
 * Query params:
 *   - provider: 'shopify' | 'woocommerce' | 'google_sheets' (required)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "matched": 150,
 *     "updated": 48,
 *     "unmapped": 12,
 *     "skipped": 2,
 *     "recommendation": "..."
 *   }
 * }
 */
router.post('/sync', authenticate, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { provider } = req.query;

    if (!provider) {
      // Default to google_sheets for BD F-commerce shops
      req.query.provider = 'google_sheets';
    }

    if (provider && provider !== 'google_sheets') {
      return res.status(400).json({
        success: false,
        error: 'Only google_sheets is supported. Shopify/WooCommerce are not enabled.'
      });
    }

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'provider query parameter required. Use: google_sheets'
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
 * GET /api/inventory-sync/report
 * Get detailed inventory sync status and report
 * 
 * Query params:
 *   - provider: 'shopify' | 'woocommerce' | 'google_sheets' (required)
 *   - days: number of days to report (default: 7)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "updateProducts": 48,
 *     "unmappedItems": [...],
 *     "volumeChange": 250,
 *     "lastSync": "2026-03-25T10:30:00Z"
 *   }
 * }
 */
router.get('/report', authenticate, async (req, res, next) => {
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

/**
 * GET /api/inventory-sync/products
 * List all products that have been synced with quantity information
 * 
 * Query params:
 *   - provider: 'shopify' | 'woocommerce' | 'google_sheets' (optional filter)
 *   - limit: max results (default: 50)
 *   - offset: pagination offset (default: 0)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "products": [
 *       {
 *         "id": "prod_123",
 *         "name": "Product Name",
 *         "sku": "SKU-001",
 *         "quantity": 45,
 *         "lastSyncedAt": "2026-03-25T10:30:00Z",
 *         "provider": "shopify"
 *       }
 *     ],
 *     "total": 150,
 *     "limit": 50,
 *     "offset": 0
 *   }
 * }
 */
router.get('/products', authenticate, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { provider, limit = 50, offset = 0 } = req.query;

    // Get synced products from service
    const productsData = await productSyncService.getSyncedProducts(
      shopId,
      provider,
      parseInt(limit),
      parseInt(offset)
    );

    res.status(200).json({
      success: true,
      data: productsData
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
