/**
 * Inventory Synchronization Service
 * 
 * Prevents AI from confirming out-of-stock orders by checking stock BEFORE order creation
 * Integrates with external inventory sources (Shopify, WooCommerce, Google Sheets, manual)
 * 
 * @file integration/inventory-sync.service.js
 */

const axios = require('axios');
const { Product, Shop, Order, Channel, InventoryCache } = require('../entities');
const { AppError } = require('../../utils/AppError');

/**
 * INVENTORY SYNC STRATEGY
 * 
 * 1. Before AI confirms an order, call checkInventory()
 * 2. Query the shop's configured inventory source
 * 3. Return stock status with timestamp
 * 4. If insufficient stock, AI should NOT confirm — escalate instead
 * 5. Cache results for 30 seconds to avoid rate limiting
 * 
 * Supported sources:
 * - Shopify API (real-time)
 * - WooCommerce REST API
 * - Google Sheets (via Sheets API)
 * - Manual inventory (EasyMod database)
 * - CSV import (periodic updates)
 */

const INVENTORY_CACHE_TTL = 30000; // 30 seconds
const INVENTORY_SOURCES = ['shopify', 'woocommerce', 'google_sheets', 'manual', 'csv'];

/**
 * Check if a product has sufficient stock before order confirmation
 * 
 * @param {string} shopId - Shop ID
 * @param {string} productId - Product ID (from EasyMod system)
 * @param {number} requestedQuantity - Requested quantity
 * @param {Object} options - Optional parameters
 * @returns {Promise<Object>} Stock status object
 * 
 * Example response:
 * {
 *   available: true,
 *   quantity: 150,
 *   requested: 50,
 *   shortage: 0,
 *   source: 'shopify',
 *   lastUpdated: '2025-03-25T10:30:00Z',
 *   recommendation: 'Confirm order'
 * }
 */
async function checkInventory(shopId, productId, requestedQuantity, options = {}) {
  try {
    // Fetch shop configuration
    const shop = await Shop.findByPk(shopId, {
      attributes: ['id', 'inventory_source', 'inventory_config']
    });

    if (!shop) {
      throw new AppError('Shop not found', 404);
    }

    const source = shop.inventory_source || 'manual';
    
    // Check cache first (avoid repeated API calls)
    const cacheKey = `${shopId}:${productId}`;
    const cached = await getInventoryCache(cacheKey);
    
    if (cached && !options.skipCache) {
      const timeSinceCache = Date.now() - cached.cachedAt;
      if (timeSinceCache < INVENTORY_CACHE_TTL) {
        return { ...cached, fromCache: true };
      }
    }

    // Query based on source
    let stockData;
    switch (source) {
      case 'shopify':
        stockData = await checkShopifyInventory(shop, productId, requestedQuantity);
        break;
      case 'woocommerce':
        stockData = await checkWooCommerceInventory(shop, productId, requestedQuantity);
        break;
      case 'google_sheets':
        stockData = await checkGoogleSheetsInventory(shop, productId, requestedQuantity);
        break;
      case 'csv':
        stockData = await checkCSVInventory(shop, productId, requestedQuantity);
        break;
      case 'manual':
      default:
        stockData = await checkManualInventory(shop, productId, requestedQuantity);
    }

    // Cache the result
    if (stockData && !options.skipCache) {
      await setInventoryCache(cacheKey, stockData);
    }

    return {
      ...stockData,
      source,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('[Inventory Sync] Error checking inventory:', error.message);
    
    // Return conservative result (deny order) on error
    return {
      available: false,
      error: error.message,
      recommendation: 'Could not verify stock — escalate to manager'
    };
  }
}

/**
 * Check inventory from manual EasyMod database
 */
async function checkManualInventory(shop, productId, requestedQuantity) {
  try {
    const product = await Product.findOne({
      where: { id: productId, shop_id: shop.id }
    });

    if (!product) {
      return {
        available: false,
        error: 'Product not found',
        quantity: 0,
        requested: requestedQuantity,
        recommendation: 'Product not found in system'
      };
    }

    const stockQuantity = product.stock || 0;
    const available = stockQuantity >= requestedQuantity;
    const shortage = Math.max(0, requestedQuantity - stockQuantity);

    return {
      available,
      quantity: stockQuantity,
      requested: requestedQuantity,
      shortage,
      productName: product.name,
      source: 'manual',
      recommendation: available
        ? 'Confirm order'
        : `Only ${stockQuantity} units available. Offer backorder or reduced quantity.`
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Check inventory from Shopify API
 * Requires shop.inventory_config.shopify_store_url and shopify_access_token
 */
async function checkShopifyInventory(shop, productId, requestedQuantity) {
  if (!shop.inventory_config?.shopify_access_token) {
    throw new AppError('Shopify not configured', 400);
  }

  try {
    // Shopify expects product variant ID for stock checks
    const response = await axios.get(
      `${shop.inventory_config.shopify_store_url}/admin/api/2024-01/products/${productId}/variants.json`,
      {
        headers: { 'X-Shopify-Access-Token': shop.inventory_config.shopify_access_token }
      }
    );

    const variant = response.data.variants[0];
    if (!variant) {
      throw new Error('Product variant not found in Shopify');
    }

    const stockQuantity = variant.inventory_quantity || 0;
    const available = stockQuantity >= requestedQuantity;

    return {
      available,
      quantity: stockQuantity,
      requested: requestedQuantity,
      shortage: Math.max(0, requestedQuantity - stockQuantity),
      productName: variant.title,
      source: 'shopify',
      recommendation: available
        ? 'Confirm order'
        : `Low stock in Shopify. Only ${stockQuantity} available.`
    };
  } catch (error) {
    throw new AppError(`Shopify API error: ${error.message}`, 500);
  }
}

/**
 * Check inventory from WooCommerce REST API
 */
async function checkWooCommerceInventory(shop, productId, requestedQuantity) {
  if (!shop.inventory_config?.woocommerce_url || !shop.inventory_config?.woocommerce_api_key) {
    throw new AppError('WooCommerce not configured', 400);
  }

  try {
    const credentials = Buffer.from(
      `${shop.inventory_config.woocommerce_api_key}:${shop.inventory_config.woocommerce_api_secret}`
    ).toString('base64');

    const response = await axios.get(
      `${shop.inventory_config.woocommerce_url}/wp-json/wc/v3/products/${productId}`,
      {
        headers: { 'Authorization': `Basic ${credentials}` }
      }
    );

    const stockQuantity = response.data.stock_quantity || 0;
    const available = stockQuantity >= requestedQuantity;
    const isManaged = response.data.manage_stock === true;

    return {
      available: isManaged ? available : true, // If stock not managed, assume available
      quantity: stockQuantity,
      requested: requestedQuantity,
      shortage: Math.max(0, requestedQuantity - stockQuantity),
      productName: response.data.name,
      source: 'woocommerce',
      stockManaged: isManaged,
      recommendation: !isManaged
        ? 'Stock not managed in WooCommerce — confirm order'
        : available
        ? 'Confirm order'
        : `Low stock in WooCommerce. Only ${stockQuantity} available.`
    };
  } catch (error) {
    throw new AppError(`WooCommerce API error: ${error.message}`, 500);
  }
}

/**
 * Check inventory from Google Sheets
 * Requires shop.inventory_config.sheets_id and google_api_key
 */
async function checkGoogleSheetsInventory(shop, productId, requestedQuantity) {
  if (!shop.inventory_config?.sheets_id || !shop.inventory_config?.google_api_key) {
    throw new AppError('Google Sheets not configured', 400);
  }

  try {
    // Query Sheets API
    const response = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${shop.inventory_config.sheets_id}/values/inventory?key=${shop.inventory_config.google_api_key}`
    );

    const rows = response.data.values || [];
    const row = rows.find(r => r[0] === productId); // Assuming column 0 = product ID

    if (!row) {
      return {
        available: true, // Assume available if not found
        quantity: 0,
        requested: requestedQuantity,
        shortage: 0,
        recommendation: 'Product not found in Google Sheets — escalate to manager'
      };
    }

    const stockQuantity = parseInt(row[1]) || 0; // Column 1 = stock quantity
    const available = stockQuantity >= requestedQuantity;

    return {
      available,
      quantity: stockQuantity,
      requested: requestedQuantity,
      shortage: Math.max(0, requestedQuantity - stockQuantity),
      productName: row[2] || 'Product', // Column 2 = product name
      source: 'google_sheets',
      recommendation: available
        ? 'Confirm order'
        : `Google Sheets shows only ${stockQuantity} available`
    };
  } catch (error) {
    throw new AppError(`Google Sheets API error: ${error.message}`, 500);
  }
}

/**
 * Check inventory from CSV file
 * CSV should be periodically uploaded with format: productId, quantity, productName
 */
async function checkCSVInventory(shop, productId, requestedQuantity) {
  try {
    const product = await Product.findOne({
      where: { id: productId, shop_id: shop.id }
    });

    if (!product || !product.csv_stock) {
      return {
        available: true,
        quantity: 0,
        requested: requestedQuantity,
        recommendation: 'No CSV inventory data — using manual'
      };
    }

    const stockQuantity = product.csv_stock;
    const available = stockQuantity >= requestedQuantity;

    return {
      available,
      quantity: stockQuantity,
      requested: requestedQuantity,
      shortage: Math.max(0, requestedQuantity - stockQuantity),
      source: 'csv',
      recommendation: available
        ? 'Confirm order'
        : `CSV shows only ${stockQuantity} available (from last upload)`
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Bulk check inventory for multiple products
 * Useful for multi-item orders
 */
async function checkBulkInventory(shopId, items) {
  try {
    const results = {};

    for (const item of items) {
      const result = await checkInventory(shopId, item.productId, item.quantity, { skipCache: false });
      results[item.productId] = result;
    }

    const allAvailable = Object.values(results).every(r => r.available);

    return {
      allAvailable,
      items: results,
      recommendation: allAvailable
        ? 'All items in stock — confirm order'
        : 'One or more items out of stock — offer alternatives'
    };
  } catch (error) {
    console.error('[Inventory Sync] Error checking bulk inventory:', error.message);
    throw error;
  }
}

/**
 * Cache management functions
 */
async function getInventoryCache(cacheKey) {
  try {
    const cached = await InventoryCache.findOne({
      where: { cache_key: cacheKey }
    });

    return cached ? JSON.parse(cached.data) : null;
  } catch (error) {
    return null; // Cache miss or error; continue
  }
}

async function setInventoryCache(cacheKey, data) {
  try {
    await InventoryCache.upsert({
      cache_key: cacheKey,
      data: JSON.stringify(data),
      expires_at: new Date(Date.now() + INVENTORY_CACHE_TTL)
    });
  } catch (error) {
    // Non-critical; don't throw
    console.error('[Inventory Cache] Error caching:', error.message);
  }
}

module.exports = {
  checkInventory,
  checkBulkInventory,
  checkManualInventory,
  checkShopifyInventory,
  checkWooCommerceInventory,
  checkGoogleSheetsInventory,
  checkCSVInventory,
  INVENTORY_SOURCES,
  INVENTORY_CACHE_TTL
};
