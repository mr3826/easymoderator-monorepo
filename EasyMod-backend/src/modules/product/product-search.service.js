/**
 * Product Search Service
 *
 * Searches products using AI-extracted attributes and returns LIVE product
 * data from the DB. This is the grounding layer — ensures the chatbot
 * never hallucinates stale prices, stock, or sizes.
 *
 * Called by: intent-router when customer sends a product image.
 */

const { sequelize } = require('../../utils/database/database-setup');
const { QueryTypes } = require('sequelize');

/**
 * Builds full-text search query from all available signals
 * @param {Object} params - Search parameters
 * @returns {string} Sanitized tsquery string
 */
const buildSearchQuery = ({ query, category, color, material, tags = [] }) => {
    const searchTerms = [query, category, color, material, ...(tags || [])].filter(Boolean);
    return searchTerms
        .map(t => t.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF\s]/g, '').trim())
        .filter(Boolean)
        .join(' | ');  // OR semantics — match any term
};

/**
 * Checks if search has meaningful attributes
 * @param {string} tsQuery - Built search query
 * @param {string} category - Category filter
 * @param {string} color - Color filter
 * @returns {boolean} True if search has no useful attributes
 */
const hasNoSearchAttributes = (tsQuery, category, color) => !tsQuery && !category && !color;

/**
 * Builds SQL query replacements object
 * @param {Object} params - Search parameters
 * @param {string} tsQuery - Built search query
 * @returns {Object} Query replacements
 */
const buildQueryReplacements = ({ shopId, category, color, material, limit }, tsQuery) => ({
    shopId,
    category: category || '',
    color: color || '',
    material: material || '',
    categoryWild: `%${category || ''}%`,
    colorWild: `%${color || ''}%`,
    materialWild: `%${material || ''}%`,
    tsQuery,
    tsQuerySafe: sanitizeTsQuery(tsQuery),
    limit
});

/**
 * Gets the search SQL query string
 * @returns {string} SQL query
 */
const getSearchSql = () => `
    SELECT
        p.id,
        p.name,
        p.name_bn,
        p.category,
        p.price,
        p.compare_at_price,
        p.quantity,
        p.in_stock,
        p.is_active,
        p.variants,
        p.images,
        p.image_url,
        p.tags,
        p.brand,
        p.description,
        p.ai_description,
        p.ai_tags,
        p.ai_category,
        p.ai_color_primary,
        p.ai_material,
        p.ai_attributes,
        -- relevance score
        (
            CASE WHEN p.ai_category ILIKE :category THEN 4 ELSE 0 END +
            CASE WHEN p.ai_color_primary ILIKE :color THEN 3 ELSE 0 END +
            CASE WHEN p.ai_material ILIKE :material THEN 2 ELSE 0 END +
            CASE WHEN :tsQuery != '' THEN
                ts_rank(
                    to_tsvector('english',
                        coalesce(p.name,'') || ' ' ||
                        coalesce(p.name_bn,'') || ' ' ||
                        coalesce(p.ai_search_text,'') || ' ' ||
                        coalesce(p.ai_category,'') || ' ' ||
                        coalesce(p.ai_color_primary,'') || ' ' ||
                        coalesce(p.ai_material,'') || ' ' ||
                        coalesce(p.category,'')
                    ),
                    to_tsquery('english', :tsQuerySafe)
                ) * 10
            ELSE 0 END
        ) AS relevance
    FROM products p
    WHERE
        p.shop_id = :shopId
        AND p.deleted_at IS NULL
        AND p.is_active = true
        AND (
            -- Each attribute filter MUST be gated on the attribute being present.
            -- An absent filter becomes the wildcard '%%' (see buildQueryReplacements),
            -- and 'anything' ILIKE '%%' is TRUE — so an ungated clause turned this
            -- WHERE into a tautology and every free-text query matched the whole
            -- catalogue. The chatbot then injected 5 arbitrary products as
            -- "RELEVANT SHOP PRODUCTS ... use ONLY these facts", which is exactly
            -- the wrong-price hallucination the grounding block exists to prevent.
            (:category != '' AND p.ai_category ILIKE :categoryWild)
            OR (:color != '' AND p.ai_color_primary ILIKE :colorWild)
            OR (:material != '' AND p.ai_material ILIKE :materialWild)
            OR (:category != '' AND p.category ILIKE :categoryWild)
            OR (
                :tsQuery != '' AND
                to_tsvector('english',
                    coalesce(p.name,'') || ' ' ||
                    coalesce(p.name_bn,'') || ' ' ||
                    coalesce(p.ai_search_text,'') || ' ' ||
                    coalesce(p.ai_category,'') || ' ' ||
                    coalesce(p.ai_color_primary,'') || ' ' ||
                    coalesce(p.ai_material,'') || ' ' ||
                    coalesce(p.category,'')
                ) @@ to_tsquery('english', :tsQuerySafe)
            )
        )
    ORDER BY relevance DESC, p.quantity DESC, p.created_at DESC
    LIMIT :limit
`;

/**
 * Search products for a shop using vision-extracted attributes.
 * Refactored to reduce complexity - orchestration only.
 *
 * @param {object} params
 * @param {string} params.shopId
 * @param {string} [params.category]      - e.g. "saree"
 * @param {string} [params.color]         - e.g. "blue"
 * @param {string} [params.material]      - e.g. "cotton"
 * @param {string} [params.query]         - free-text search query
 * @param {string[]} [params.tags]        - extracted tags
 * @param {number} [params.limit]         - max results (default 5)
 * @returns {Promise<ProductResult[]>}
 */
const searchByAttributes = async (params) => {
    const { shopId, category, color, limit = 5 } = params;

    const tsQuery = buildSearchQuery(params);

    if (hasNoSearchAttributes(tsQuery, category, color)) {
        return fallbackSearch(shopId, limit);
    }

    const results = await sequelize.query(
        getSearchSql(),
        {
            replacements: buildQueryReplacements(params, tsQuery),
            type: QueryTypes.SELECT
        }
    ).catch(err => {
        console.error('[ProductSearch] Query error:', err.message);
        return [];
    });

    return results.map(formatProduct);
};

/**
 * Get a specific product by ID with live data (for order session validation).
 */
const getProductLive = async (productId, shopId) => {
    const results = await sequelize.query(`
        SELECT id, name, name_bn, price, compare_at_price,
               quantity, in_stock, is_active, variants,
               images, image_url, category, ai_category
        FROM products
        WHERE id = :productId AND shop_id = :shopId AND deleted_at IS NULL
        LIMIT 1
    `, {
        replacements: { productId, shopId },
        type: QueryTypes.SELECT
    });
    return results[0] ? formatProduct(results[0]) : null;
};

/**
 * Validate stock for a product before starting order.
 * Returns { available: bool, reason: string }.
 */
const checkStock = async (productId, shopId, requestedQty = 1) => {
    const product = await getProductLive(productId, shopId);
    if (!product) return { available: false, reason: 'Product not found' };
    if (!product.is_active) return { available: false, reason: 'Product is no longer available' };
    if (!product.in_stock) return { available: false, reason: 'Product is out of stock' };
    if (product.track_quantity && product.quantity < requestedQty) {
        // Expose the live count so callers can localise "only N left" without re-querying.
        return { available: false, reason: `Only ${product.quantity} unit(s) left in stock`, quantity: product.quantity };
    }
    return { available: true, reason: null, product };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fallbackSearch = async (shopId, limit) => {
    const results = await sequelize.query(`
        SELECT id, name, name_bn, price, compare_at_price,
               quantity, in_stock, is_active, variants, images, image_url,
               tags, brand, description, ai_description, ai_tags,
               ai_category, ai_color_primary, ai_material, ai_attributes
        FROM products
        WHERE shop_id = :shopId AND deleted_at IS NULL AND is_active = true
        ORDER BY quantity DESC, created_at DESC
        LIMIT :limit
    `, { replacements: { shopId, limit }, type: QueryTypes.SELECT });
    return results.map(formatProduct);
};

const formatProduct = (row) => ({
    id:               row.id,
    name:             row.name,
    name_bn:          row.name_bn || null,
    category:         row.ai_category || row.category || null,
    price:            parseFloat(row.price) || 0,
    compare_at_price: row.compare_at_price ? parseFloat(row.compare_at_price) : null,
    quantity:         row.quantity || 0,
    in_stock:         row.in_stock !== false,
    is_active:        row.is_active !== false,
    variants:         parseJson(row.variants, []),
    images:           parseJson(row.images, []),
    image_url:        row.image_url || null,
    tags:             parseJson(row.tags, []),
    brand:            row.brand || null,
    description:      row.description || null,
    // AI fields (search-only — do NOT expose prices/stock from here)
    ai_description:   row.ai_description || null,
    ai_tags:          parseJson(row.ai_tags, []),
    ai_color:         row.ai_color_primary || null,
    ai_material:      row.ai_material || null,
    ai_attributes:    parseJson(row.ai_attributes, {})
});

const parseJson = (val, fallback) => {
    if (!val) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return fallback; }
};

/**
 * Sanitize a tsquery string to prevent syntax errors.
 * Converts free text to a safe OR tsquery.
 */
const sanitizeTsQuery = (q) => {
    if (!q) return '';
    // Split on spaces/pipes, sanitize each word, join with |
    const words = q.split(/[\s|]+/)
        .map(w => w.replace(/[^a-z0-9\u0980-\u09FF]/g, '').trim())
        .filter(w => w.length >= 2);
    if (!words.length) return '';
    return words.join(' | ');
};

/**
 * Fetch live product records by a list of IDs.
 * Used by the RAG tier to convert vector-store hits (product_id metadata)
 * into full DB records with current price, stock, and variants.
 *
 * @param {string[]} productIds
 * @param {string} shopId
 * @returns {Promise<ProductResult[]>}
 */
const getProductsByIds = async (productIds, shopId) => {
    if (!productIds.length) return [];
    const results = await sequelize.query(`
        SELECT
            id, name, name_bn, category, price, compare_at_price,
            quantity, in_stock, is_active, variants, images, image_url,
            tags, brand, description, ai_description, ai_tags,
            ai_category, ai_color_primary, ai_material, ai_attributes
        FROM products
        WHERE shop_id = :shopId
          AND id IN (:productIds)
          AND deleted_at IS NULL
          AND is_active = true
        LIMIT 10
    `, {
        replacements: { shopId, productIds },
        type: QueryTypes.SELECT
    }).catch(err => {
        console.error('[ProductSearch] getProductsByIds error:', err.message);
        return [];
    });
    return results.map(formatProduct);
};

/**
 * Find products a customer can actually order from a free-text message.
 *
 * Unlike searchByAttributes (which falls back to dumping the whole catalog when
 * the message has no usable search terms), this NEVER falls back — it returns an
 * empty list when the message produced no real full-text query. That distinction
 * matters for the order-capture flow: we must only auto-start an order session
 * when we can confidently identify the product the customer named. Linking an
 * arbitrary fallback product to an order would be worse than asking which item.
 *
 * @param {object} params
 * @param {string} params.shopId
 * @param {string} params.query    - raw customer message
 * @param {number} [params.limit]  - max results (default 5)
 * @returns {Promise<{ products: ProductResult[], wasFallback: boolean }>}
 */
const searchForOrder = async ({ shopId, query, limit = 5 }) => {
    const tsQuery = buildSearchQuery({ query });
    if (hasNoSearchAttributes(tsQuery, null, null)) {
        // No real product terms in the message → don't guess a product.
        return { products: [], wasFallback: true };
    }

    const results = await sequelize.query(
        getSearchSql(),
        {
            replacements: buildQueryReplacements({ shopId, limit }, tsQuery),
            type: QueryTypes.SELECT
        }
    ).catch(err => {
        console.error('[ProductSearch] searchForOrder query error:', err.message);
        return [];
    });

    return { products: results.map(formatProduct), wasFallback: false };
};

module.exports = {
    searchByAttributes,
    searchForOrder,
    getProductsByIds,
    getProductLive,
    checkStock
};
