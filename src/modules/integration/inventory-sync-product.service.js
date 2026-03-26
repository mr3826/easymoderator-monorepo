/**
 * Enhanced Inventory Sync Service - Product Module Integration
 * 
 * Syncs inventory from external sources (Shopify, WooCommerce, Google Sheets)
 * directly to your app's Product module by matching SKU
 * 
 * Key Features:
 * - SKU-based matching between external sources and app products
 * - Respects product.track_quantity flag (only syncs if enabled)
 * - Tracks sync history in inventory_sync_logs
 * - Creates unmapped items report for products with no SKU match
 * - Supports bulk updates and scheduled syncing
 * 
 * @file integration/inventory-sync-product.service.js
 */

const axios = require('axios');
const { Product, Shop, InventorySyncLog } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('InventorySyncProduct');

/**
 * Sync inventory from external source to app's Product module
 * Only updates products with track_quantity=true
 * 
 * Core Logic:
 * 1. Fetch inventory data from external source
 * 2. For each item: find app product by SKU
 * 3. If found AND track_quantity=true: update product.quantity
 * 4. Log all changes and unmapped items
 * 5. Update last_sync timestamp
 * 
 * @param {string} shopId - Shop ID
 * @param {string} provider - 'shopify' | 'woocommerce' | 'google_sheets'
 * @returns {Promise<Object>} Sync summary with counts
 */
async function syncProductInventory(shopId, provider) {
  try {
    logger.info('Starting product inventory sync', { shopId, provider });

    // Get sync config
    const config = await getSyncConfig(shopId, provider);
    if (!config) {
      throw new AppError(`No sync configuration found for ${provider}`, 404);
    }

    // Fetch inventory from external source
    let externalInventory;
    switch (provider) {
      case 'shopify':
        externalInventory = await fetchShopifyProductInventory(config);
        break;
      case 'woocommerce':
        externalInventory = await fetchWooCommerceProductInventory(config);
        break;
      case 'google_sheets':
        externalInventory = await fetchGoogleSheetsProductInventory(config);
        break;
      default:
        throw new AppError(`Unknown provider: ${provider}`, 400);
    }

    // Sync to app products
    const syncResult = await syncExternalInventoryToProducts(shopId, externalInventory, provider);

    logger.info('Product inventory sync completed', { shopId, provider, ...syncResult });
    return syncResult;
  } catch (error) {
    logger.error('Error syncing product inventory', { shopId, provider, error });
    throw error;
  }
}

/**
 * Get sync configuration for provider
 */
async function getSyncConfig(shopId, provider) {
  const shop = await Shop.findByPk(shopId, {
    attributes: ['inventory_config']
  });

  if (!shop?.inventory_config?.[provider]) {
    return null;
  }

  return shop.inventory_config[provider];
}

/**
 * Fetch Shopify product inventory
 */
async function fetchShopifyProductInventory(config) {
  try {
    const { store_url, access_token } = config;
    const baseUrl = `${store_url}/admin/api/2024-01`;

    const response = await axios.get(`${baseUrl}/products.json`, {
      headers: { 'X-Shopify-Access-Token': access_token },
      params: { limit: 250, fields: 'id,title,handle,variants' }
    });

    const inventory = [];
    for (const product of response.data.products || []) {
      for (const variant of product.variants || []) {
        inventory.push({
          externalId: String(product.id),
          sku: variant.sku || '',
          title: product.title,
          quantity: variant.inventory_quantity || 0,
          source: 'shopify',
          externalUrl: `${store_url}/admin/products/${product.id}`
        });
      }
    }

    return inventory;
  } catch (error) {
    logger.error('Error fetching Shopify inventory', { error });
    throw new AppError(`Shopify API error: ${error.message}`, 500);
  }
}

/**
 * Fetch WooCommerce product inventory
 */
async function fetchWooCommerceProductInventory(config) {
  try {
    const { store_url, consumer_key, consumer_secret } = config;
    const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString('base64');

    const response = await axios.get(`${store_url}/wp-json/wc/v3/products`, {
      headers: { 'Authorization': `Basic ${auth}` },
      params: { per_page: 100 }
    });

    const inventory = response.data.map(product => ({
      externalId: String(product.id),
      sku: product.sku || '',
      title: product.name,
      quantity: product.stock_quantity || 0,
      source: 'woocommerce',
      externalUrl: `${store_url}/wp-admin/post.php?post=${product.id}&action=edit`
    }));

    return inventory;
  } catch (error) {
    logger.error('Error fetching WooCommerce inventory', { error });
    throw new AppError(`WooCommerce API error: ${error.message}`, 500);
  }
}

/**
 * Fetch Google Sheets product inventory
 * Expected columns: SKU, Product Name, Quantity
 */
async function fetchGoogleSheetsProductInventory(config) {
  try {
    const { spreadsheet_id, sheet_name, api_key } = config;

    const response = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${sheet_name}`,
      {
        params: { key: api_key, majorDimension: 'ROWS' }
      }
    );

    const values = response.data.values || [];
    if (values.length < 2) {
      throw new Error('Sheet must have header row');
    }

    // Find column indexes (case-insensitive)
    const [headers, ...rows] = values;
    const skuIdx = headers.findIndex(h => h.toLowerCase().includes('sku'));
    const nameIdx = headers.findIndex(h => h.toLowerCase().includes('product') || h.toLowerCase().includes('name'));
    const qtyIdx = headers.findIndex(h => 
      h.toLowerCase().includes('quantity') || 
      h.toLowerCase().includes('qty') || 
      h.toLowerCase().includes('stock')
    );

    if (skuIdx === -1 || qtyIdx === -1) {
      throw new Error('Sheet must have SKU and Quantity columns');
    }

    const inventory = rows
      .filter(row => row[skuIdx]) // Only rows with SKU
      .map(row => ({
        sku: String(row[skuIdx] || '').trim(),
        title: String(row[nameIdx] || '').trim(),
        quantity: parseInt(row[qtyIdx]) || 0,
        source: 'google_sheets'
      }));

    return inventory;
  } catch (error) {
    logger.error('Error fetching Google Sheets inventory', { error });
    throw new AppError(`Google Sheets API error: ${error.message}`, 500);
  }
}

/**
 * Core sync logic: Match external SKUs to app products and update quantities
 */
async function syncExternalInventoryToProducts(shopId, externalInventory, source) {
  let matched = 0;
  let updated = 0;
  let skipped = 0;
  let unmapped = 0;
  const updates = [];

  for (const extItem of externalInventory) {
    try {
      if (!extItem.sku) {
        unmapped++;
        continue;
      }

      // Find product in app by SKU
      const appProduct = await Product.findOne({
        where: {
          shop_id: shopId,
          sku: extItem.sku.toLowerCase().trim()
        }
      });

      if (appProduct) {
        matched++;

        // Only sync if quantity tracking is enabled for this product
        if (appProduct.track_quantity) {
          const oldQty = appProduct.quantity || 0;
          const newQty = extItem.quantity;

          // Update product quantity
          appProduct.quantity = newQty;
          appProduct.in_stock = newQty > 0;
          appProduct.updated_at = new Date();
          appProduct.last_inventory_sync = new Date();
          await appProduct.save();

          updated++;
          updates.push({
            productId: appProduct.id,
            sku: extItem.sku,
            oldQty,
            newQty,
            change: newQty - oldQty
          });

          // Log significant changes
          if (Math.abs(oldQty - newQty) > 0) {
            await InventorySyncLog.create({
              shop_id: shopId,
              product_id: appProduct.id,
              sku: extItem.sku,
              old_quantity: oldQty,
              new_quantity: newQty,
              source: source,
              sync_type: 'quantity_update',
              title: appProduct.name
            });
          }

          logger.debug('Product quantity updated', {
            shopId,
            productId: appProduct.id,
            sku: extItem.sku,
            oldQty,
            newQty
          });
        } else {
          // Product exists but quantity tracking disabled
          skipped++;
          await InventorySyncLog.create({
            shop_id: shopId,
            product_id: appProduct.id,
            sku: extItem.sku,
            new_quantity: extItem.quantity,
            source: source,
            sync_type: 'skipped',
            title: appProduct.name,
            notes: 'Quantity tracking disabled for this product'
          });
        }
      } else {
        // No product found with this SKU
        unmapped++;
        await InventorySyncLog.create({
          shop_id: shopId,
          sku: extItem.sku,
          title: extItem.title,
          new_quantity: extItem.quantity,
          source: source,
          sync_type: 'unmapped',
          notes: `Product not found in app. User must upload product to app with SKU="${extItem.sku}"`
        });

        logger.info('Unmapped external product', {
          shopId,
          externalSku: extItem.sku,
          externalTitle: extItem.title,
          source
        });
      }
    } catch (itemError) {
      logger.warn('Error syncing single item', {
        shopId,
        sku: extItem.sku,
        error: itemError.message
      });
      skipped++;
    }
  }

  return {
    total: externalInventory.length,
    matched,      // Found matching app product by SKU
    updated,       // Actually updated quantity
    skipped,       // Skipped (no tracking or error)
    unmapped,      // No app product with this SKU
    details: updates,
    syncedAt: new Date().toISOString(),
    recommendation: unmapped > 0 
      ? `${unmapped} external products have no matching app product. Users must upload these products to app or ensure SKU is set.`
      : 'All external products matched successfully'
  };
}

/**
 * Get sync status and unmapped items report
 */
async function getSyncReport(shopId, source, days = 7) {
  try {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await InventorySyncLog.findAll({
      where: {
        shop_id: shopId,
        source,
        created_at: { [require('sequelize').Op.gte]: startDate }
      },
      order: [['created_at', 'DESC']]
    });

    const unmapped = logs.filter(l => l.sync_type === 'unmapped');
    const updated = logs.filter(l => l.sync_type === 'quantity_update');
    const skipped = logs.filter(l => l.sync_type === 'skipped');

    // Calculate volume changes
    const volumeChange = updated.reduce((sum, log) => {
      return sum + ((log.new_quantity || 0) - (log.old_quantity || 0));
    }, 0);

    return {
      period: `${days} days`,
      source,
      totalSyncs: logs.length,
      updatedProducts: updated.length,
      skippedProducts: skipped.length,
      unmappedExternal: unmapped.length,
      totalVolumeSynced: updated.reduce((sum, l) => sum + (l.new_quantity || 0), 0),
      volumeChange,
      lastSync: logs[0]?.created_at,
      unmappedItems: unmapped.map(u => ({
        sku: u.sku,
        title: u.title,
        externalQty: u.new_quantity,
        notes: u.notes
      }))
    };
  } catch (error) {
    logger.error('Error generating sync report', { shopId, source, error });
    throw error;
  }
}

/**
 * Get list of synced products with quantities
 * Retrieves products that have been recently synced or have sync history
 * 
 * @param {string} shopId - Shop ID
 * @param {string} provider - Optional provider filter ('shopify', 'woocommerce', 'google_sheets')
 * @param {number} limit - Results per page (default: 50)
 * @param {number} offset - Pagination offset (default: 0)
 * @returns {Promise<Object>} Object with products array and pagination info
 */
async function getSyncedProducts(shopId, provider, limit = 50, offset = 0) {
  try {
    logger.info('Fetching synced products', { shopId, provider, limit, offset });

    // Get synced product SKUs from recent logs
    const where = {
      shop_id: shopId,
      sync_type: 'quantity_update'
    };

    if (provider) {
      where.source = provider;
    }

    const syncLog = await InventorySyncLog.findAll({
      where,
      attributes: ['sku', 'source', 'created_at'],
      order: [['created_at', 'DESC']],
      raw: true,
      subQuery: false
    });

    // Get unique SKUs with most recent sync info
    const syncedSkus = new Map();
    syncLog.forEach(log => {
      if (!syncedSkus.has(log.sku)) {
        syncedSkus.set(log.sku, {
          sku: log.sku,
          provider: log.source,
          lastSyncedAt: log.created_at
        });
      }
    });

    // Fetch actual products by SKU
    const products = await Product.findAll({
      where: {
        shop_id: shopId,
        sku: { [require('sequelize').Op.in]: Array.from(syncedSkus.keys()) || [''] },
        deleted_at: null
      },
      attributes: ['id', 'name', 'sku', 'quantity', 'created_at', 'updated_at'],
      limit,
      offset,
      order: [['updated_at', 'DESC']],
      raw: true
    });

    // Enrich products with sync info
    const enrichedProducts = products.map(prod => ({
      id: prod.id,
      name: prod.name,
      sku: prod.sku,
      quantity: prod.quantity,
      lastSyncedAt: syncedSkus.get(prod.sku)?.lastSyncedAt,
      provider: syncedSkus.get(prod.sku)?.provider
    }));

    // Get total count
    const totalCount = await Product.count({
      where: {
        shop_id: shopId,
        sku: { [require('sequelize').Op.in]: Array.from(syncedSkus.keys()) || [''] },
        deleted_at: null
      }
    });

    return {
      products: enrichedProducts,
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount
    };
  } catch (error) {
    logger.error('Error fetching synced products', { shopId, error });
    throw error;
  }
}

module.exports = {
  syncProductInventory,
  syncExternalInventoryToProducts,
  fetchShopifyProductInventory,
  fetchWooCommerceProductInventory,
  fetchGoogleSheetsProductInventory,
  getSyncConfig,
  getSyncReport,
  getSyncedProducts
};
