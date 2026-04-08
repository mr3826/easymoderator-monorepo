/**
 * StockStatusGuard
 *
 * Redis-backed cache for product stock levels.
 * Stock is too dynamic to embed in the vector store — this guard ensures
 * the chatbot always serves live stock info without hitting PostgreSQL on
 * every message.
 *
 * Cache key: stock:<shopId>:<productId>
 * TTL: 5 minutes (STOCK_CACHE_TTL_SECONDS env, default 300)
 *
 * Invalidation:
 *   - Manual: call invalidate(shopId, productId) after any order/stock update
 *   - Google Sheets webhook: POST /api/products/stock-sync triggers invalidateShop()
 *
 * On cache miss the guard fetches live quantity from PostgreSQL and writes it
 * back to Redis — so the next request within TTL is a cache hit.
 */

const { cacheRedis } = require('../../config/redis');
const { Product } = require('../entities');

const TTL = parseInt(process.env.STOCK_CACHE_TTL_SECONDS || '300', 10);

const cacheKey = (shopId, productId) => `stock:${shopId}:${productId}`;

/**
 * Get live stock info for a product.
 * Returns cache hit if available, otherwise fetches from DB and caches.
 *
 * @param {string} productId
 * @param {string} shopId
 * @returns {Promise<{quantity: number, in_stock: boolean, cached: boolean}>}
 */
const getStock = async (productId, shopId) => {
    const key = cacheKey(shopId, productId);

    try {
        const cached = await cacheRedis.get(key);
        if (cached) {
            const parsed = JSON.parse(cached);
            return { ...parsed, cached: true };
        }
    } catch (_) {
        // Redis unavailable — fall through to DB
    }

    // Cache miss — fetch from DB
    const product = await Product.findOne({
        where: { id: productId, shop_id: shopId },
        attributes: ['id', 'quantity', 'in_stock', 'track_quantity']
    });

    if (!product) {
        return { quantity: 0, in_stock: false, cached: false };
    }

    const stockData = {
        quantity: product.track_quantity ? (product.quantity || 0) : null,
        in_stock: product.in_stock !== false && (product.track_quantity ? product.quantity > 0 : true)
    };

    // Write to cache
    try {
        await cacheRedis.setex(key, TTL, JSON.stringify(stockData));
    } catch (_) {
        // Non-fatal — we still have fresh data from DB
    }

    return { ...stockData, cached: false };
};

/**
 * Invalidate cache for a specific product (call after stock change).
 * @param {string} shopId
 * @param {string} productId
 */
const invalidate = async (shopId, productId) => {
    try {
        await cacheRedis.del(cacheKey(shopId, productId));
    } catch (_) { /* non-fatal */ }
};

/**
 * Invalidate all stock cache entries for a shop.
 * Called when a Google Sheets sync webhook fires.
 * Uses SCAN to avoid blocking Redis with a full KEYS scan.
 * @param {string} shopId
 */
const invalidateShop = async (shopId) => {
    const pattern = `stock:${shopId}:*`;
    try {
        let cursor = '0';
        do {
            const [nextCursor, keys] = await cacheRedis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            if (keys.length) await cacheRedis.del(...keys);
            cursor = nextCursor;
        } while (cursor !== '0');
    } catch (_) { /* non-fatal */ }
};

/**
 * Enrich an array of products with live stock data.
 * Used by ImageProductMatcher and RAG response builder.
 *
 * @param {object[]} products — plain product objects with at least { id, shop_id }
 * @returns {Promise<object[]>} same array, each item extended with { live_quantity, live_in_stock }
 */
const enrichWithStock = async (products) => {
    return Promise.all(
        products.map(async (p) => {
            const stock = await getStock(p.id, p.shop_id);
            return {
                ...p,
                live_quantity: stock.quantity,
                live_in_stock: stock.in_stock
            };
        })
    );
};

/**
 * Format stock availability as a customer-friendly Banglish string.
 * @param {{ live_in_stock: boolean, live_quantity: number|null }} product
 * @returns {string}
 */
const formatStockLabel = (product) => {
    if (!product.live_in_stock) return 'স্টক নেই (out of stock)';
    if (product.live_quantity === null) return 'আছে ✅';         // untracked — assume available
    if (product.live_quantity <= 5)    return `শুধু ${product.live_quantity}টি বাকি আছে ⚠️`;
    return 'আছে ✅';
};

module.exports = { getStock, invalidate, invalidateShop, enrichWithStock, formatStockLabel };
