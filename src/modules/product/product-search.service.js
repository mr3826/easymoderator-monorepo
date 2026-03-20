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
 * Search products for a shop using vision-extracted attributes.
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
const searchByAttributes = async ({ shopId, category, color, material, query, tags = [], limit = 5 }) => {
    // Build full-text search query from all available signals
    const searchTerms = [query, category, color, material, ...(tags || [])].filter(Boolean);
    const tsQuery = searchTerms
        .map(t => t.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF\s]/g, '').trim())
        .filter(Boolean)
        .join(' | ');  // OR semantics — match any term

    if (!tsQuery && !category && !color) {
        // No useful attributes — return active products sorted by recent
        return fallbackSearch(shopId, limit);
    }

    const results = await sequelize.query(`
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
                p.ai_category ILIKE :categoryWild
                OR p.ai_color_primary ILIKE :colorWild
                OR p.ai_material ILIKE :materialWild
                OR p.category ILIKE :categoryWild
                OR (
                    :tsQuery != '' AND
                    to_tsvector('english',
                        coalesce(p.name,'') || ' ' ||
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
    `, {
        replacements: {
            shopId,
            category:     category || '',
            color:        color || '',
            material:     material || '',
            categoryWild: `%${category || ''}%`,
            colorWild:    `%${color || ''}%`,
            materialWild: `%${material || ''}%`,
            tsQuery:      tsQuery,
            tsQuerySafe:  sanitizeTsQuery(tsQuery),
            limit
        },
        type: QueryTypes.SELECT
    }).catch(err => {
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
        return { available: false, reason: `Only ${product.quantity} unit(s) left in stock` };
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
 * Format product data as a grounded context block for the LLM system prompt.
 * Never include costs, margins, or internal IDs.
 */
const formatProductsForLlm = (products) => {
    if (!products.length) return '';

    return products.map((p, i) => {
        const lines = [`${i + 1}. ${p.name}${p.name_bn ? ` / ${p.name_bn}` : ''}`];

        // Live facts — always from DB
        lines.push(`   Price: ৳${p.price}${p.compare_at_price ? ` (was ৳${p.compare_at_price})` : ''}`);

        // Stock status
        if (!p.is_active) {
            lines.push('   Status: DISCONTINUED — not available for order');
        } else if (!p.in_stock || p.quantity === 0) {
            lines.push('   Status: OUT OF STOCK — cannot be ordered');
        } else {
            lines.push(`   Status: IN STOCK (${p.quantity} available)`);
        }

        // Variants / sizes
        if (p.variants && p.variants.length > 0) {
            const sizes = extractSizes(p.variants);
            if (sizes.length) lines.push(`   Sizes: ${sizes.join(', ')}`);
            const colors = extractColors(p.variants);
            if (colors.length) lines.push(`   Colors: ${colors.join(', ')}`);
        }

        if (p.brand) lines.push(`   Brand: ${p.brand}`);
        if (p.category) lines.push(`   Category: ${p.category}`);

        return lines.join('\n');
    }).join('\n\n');
};

const extractSizes = (variants) => {
    const sizes = new Set();
    for (const v of variants) {
        if (v.size) sizes.add(v.size);
        if (v.option === 'Size' && v.value) sizes.add(v.value);
    }
    return [...sizes];
};

const extractColors = (variants) => {
    const colors = new Set();
    for (const v of variants) {
        if (v.color) colors.add(v.color);
        if (v.option === 'Color' && v.value) colors.add(v.value);
    }
    return [...colors];
};

module.exports = {
    searchByAttributes,
    getProductLive,
    checkStock,
    formatProductsForLlm
};
