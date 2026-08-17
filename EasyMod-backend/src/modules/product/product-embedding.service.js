/**
 * Product Embedding Service
 *
 * Builds a canonical text document from a product record and upserts it
 * into the vector store (Qdrant via rag.service).
 *
 * Document format (optimised for Bengali + Banglish search):
 *   "<name> | <name_bn> | sizes: <variants> | price: <price> BDT |
 *    category: <category> | <ai_tags> | <description>"
 *
 * Stock quantity is intentionally NOT embedded — it changes too often.
 * Stock is fetched live via StockStatusGuard (Redis TTL cache).
 *
 * Called automatically after product create/update via product-ai.service.js.
 * Can also be called directly for bulk re-indexing.
 */

const { ingestData } = require('../rag/rag.service');
const Product = require('./product.entity');
const { buildEmbeddingText } = require('./product-embedding-text');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('ProductEmbedding');

/**
 * Upsert a single product into the vector store.
 * Idempotent — uses the product ID as the document ID so re-runs overwrite.
 *
 * @param {string} productId
 * @param {string} shopId
 * @returns {Promise<boolean>} true if indexed, false if skipped/failed
 */
const embedProduct = async (productId, shopId) => {
    try {
        const product = await Product.findOne({ where: { id: productId, shop_id: shopId } });
        if (!product || !product.is_active) return false;

        const text = buildEmbeddingText(product);
        if (!text.trim()) return false;

        const result = await ingestData({
            text,
            metadata: {
                documentId: `product:${product.id}`,
                shopId: product.shop_id,
                type: 'product',
                product_id: product.id,
                product_name: product.name,
                embeddingTitle: product.name || 'Product',
                image_url: product.image_url || null,
                // stock_key used by StockStatusGuard to fetch live quantity from Redis
                // price, variants, stock are intentionally NOT stored here — always fetch live from DB
                stock_key: `stock:${product.shop_id}:${product.id}`
            }
        });

        // ingestData swallows vector-store/embedding errors and returns
        // { success:false } INSTEAD of throwing. We must check the flag —
        // otherwise a failed upsert is logged as success and the product is
        // silently never searchable (the "is it embedded?" blind spot).
        if (!result || !result.success) {
            logger.warn('Product embedding NOT stored — vector store/embedding unavailable', {
                productId, shopId, reason: result && result.message
            });
            return false;
        }

        logger.info('Embedded product', { productId, shopId });
        return true;
    } catch (err) {
        logger.error('Failed to embed product', err, { productId, shopId });
        return false;
    }
};

/**
 * Remove a product from the vector store (call on delete).
 * @param {string} productId
 * @param {string} shopId
 */
const removeProductEmbedding = async (productId, shopId) => {
    try {
        const { deletePoint } = require('../rag/rag.service');
        await deletePoint(`product:${productId}`, shopId);
        logger.info('Removed product embedding', { productId, shopId });
    } catch (err) {
        // Non-fatal — vector store may already be clean
        logger.error('Failed to remove product embedding', err, { productId, shopId });
    }
};

/**
 * Re-index all active products for a shop.
 * Used on initial setup or after a bulk import.
 * @param {string} shopId
 * @param {number} [limit=200]
 */
const reindexShopProducts = async (shopId, limit = 200) => {
    const products = await Product.findAll({
        where: { shop_id: shopId, is_active: true },
        limit
    });

    let indexed = 0;
    for (const product of products) {
        const ok = await embedProduct(product.id, shopId);
        if (ok) indexed++;
    }

    logger.info('Reindexed shop products', { shopId, indexed, total: products.length });
    return { indexed, total: products.length };
};

module.exports = { embedProduct, removeProductEmbedding, reindexShopProducts, buildEmbeddingText };
