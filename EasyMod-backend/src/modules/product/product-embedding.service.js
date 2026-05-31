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
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('ProductEmbedding');

/**
 * Build the canonical embedding text for a product.
 * Combines structured fields + AI-generated tags for broad retrieval coverage.
 *
 * @param {object} product — Sequelize Product instance or plain object
 * @returns {string}
 */
const buildEmbeddingText = (product) => {
    const parts = [
        product.name,
        product.name_bn,
    ];

    // Size/variant info
    const variants = product.variants || [];
    if (variants.length) {
        parts.push(`sizes: ${variants.join(', ')}`);
    }

    // Category (human + AI-detected)
    if (product.category) parts.push(`category: ${product.category}`);
    if (product.ai_category && product.ai_category !== product.category) {
        parts.push(product.ai_category);
    }

    // AI colour / material / style
    if (product.ai_color_primary) parts.push(product.ai_color_primary);
    if (product.ai_material) parts.push(product.ai_material);
    if (product.ai_attributes?.style) parts.push(product.ai_attributes.style);

    // Tags (human + AI)
    const tags = [...(product.tags || []), ...(product.ai_tags || [])];
    if (tags.length) parts.push(tags.join(' '));

    // Description
    if (product.description) parts.push(product.description);
    if (product.ai_description && product.ai_description !== product.description) {
        parts.push(product.ai_description);
    }

    // SKU (enables exact SKU lookup)
    if (product.sku) parts.push(`SKU: ${product.sku}`);

    return parts.filter(Boolean).join(' | ');
};

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

        await ingestData({
            text,
            metadata: {
                documentId: `product:${product.id}`,
                shopId: product.shop_id,
                type: 'product',
                product_id: product.id,
                product_name: product.name,
                image_url: product.image_url || null,
                // stock_key used by StockStatusGuard to fetch live quantity from Redis
                // price, variants, stock are intentionally NOT stored here — always fetch live from DB
                stock_key: `stock:${product.shop_id}:${product.id}`
            }
        });

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
