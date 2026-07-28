/**
 * Product Search-Metadata Service
 *
 * Populates the ai_* columns that product-search.service.js ranks on:
 * ai_search_text, ai_category, ai_color_primary, ai_material, ai_tags,
 * ai_description. They are for identification/search ONLY — never shown as
 * authoritative facts to customers (prices, stock, sizes always come from
 * live DB fields).
 *
 * DERIVED FROM TEXT, NOT IMAGES. This used to require a vision model, which
 * meant the columns were only ever written for products that had an image —
 * and since no image-upload endpoint exists, they were NULL for every product
 * in production. The full-text search that ranks on them was therefore running
 * on name/name_bn/category alone. Text derivation closed a measured 4.1-point
 * gap in rank-1 retrieval accuracy at zero provider cost
 * (docs/ai-cost/RETRIEVAL_QUALITY_EVALUATION.md).
 *
 * The vision path is retained but gated behind AI_VISION_ENABLED (default off);
 * see vision-policy.service.js.
 *
 * Called:
 *  - After product create/update (async, non-blocking)
 *  - By background job for products where ai_processed_at IS NULL
 */

const Product = require('./product.entity');
const llmService = require('../ai/llm.service');
const { embedProduct } = require('./product-embedding.service');
const { indexProductImage } = require('./clip-client.service');
const { visionEnabled } = require('../ai/vision-policy.service');

const ATTRIBUTE_EXTRACTION_PROMPT = `You are a product image analyzer for an e-commerce platform.
Analyze the product image and return ONLY a JSON object (no markdown, no explanation) with these fields:
{
  "category": "product category e.g. saree/shirt/panjabi/dress/shoes",
  "color_primary": "main color e.g. blue/red/white/black",
  "material": "fabric/material e.g. cotton/silk/polyester (null if unclear)",
  "style": "style descriptor e.g. traditional/casual/formal/printed (null if unclear)",
  "tags": ["array", "of", "search", "tags", "max 8"],
  "description": "1-2 sentence product description for search indexing",
  "search_text": "space-separated keywords for full-text search"
}`;

/**
 * Process a single product's images with vision LLM.
 * Saves ai_* columns directly to the DB.
 *
 * @param {string} productId
 * @param {string} shopId  - for logging
 * @returns {Promise<boolean>} true if processed, false if skipped/failed
 */
const processProduct = async (productId, shopId) => {
    const product = await Product.findOne({ where: { id: productId, shop_id: shopId } });
    if (!product) return false;

    // Collect image URLs (images array takes priority, fallback to image_url)
    const imageUrls = (product.images || []).filter(Boolean);
    if (!imageUrls.length && product.image_url) imageUrls.push(product.image_url);
    const primaryImageUrl = imageUrls[0] || null;

    try {
        // Vision is opt-in and adds nothing the merchant's own text does not
        // already state. When it is off — the default — attributes come from the
        // product record, and a product with no image is still fully searchable.
        const attrs = (visionEnabled() && primaryImageUrl)
            ? await extractAttributesFromImage(product, primaryImageUrl)
            : deriveAttributesFromText(product);

        if (!attrs) return false;

        // Build combined search text
        const searchParts = [
            product.name,
            product.name_bn,
            product.category,
            product.brand,
            product.sku,
            attrs.category,
            attrs.color_primary,
            attrs.material,
            attrs.style,
            attrs.search_text,
            (product.tags || []).join(' '),
            (attrs.tags || []).join(' ')
        ].filter(Boolean);

        await product.update({
            ai_description:  attrs.description || null,
            ai_tags:         attrs.tags || [],
            ai_category:     attrs.category || null,
            ai_color_primary: attrs.color_primary || null,
            ai_material:     attrs.material || null,
            ai_attributes:   {
                style: attrs.style || null,
                ...(attrs.attributes || {})
            },
            ai_search_text:  searchParts.join(' ').toLowerCase(),
            ai_processed_at: new Date()
        });

        // Upsert enriched product into vector store for RAG-based inbox matching
        await embedProduct(productId, shopId);

        // CLIP image indexing is an image-embedding path — gated with the rest.
        if (primaryImageUrl && visionEnabled()) {
            setImmediate(() => indexProductImage(productId, shopId, primaryImageUrl).catch(() => {}));
        }

        return true;
    } catch (err) {
        console.error(`[ProductAI] Failed to process product ${productId}:`, err.message);
        return false;
    }
};

/**
 * Derive search attributes from the product's own text fields. No provider call.
 *
 * Colour and material are read off the variant options and tags rather than
 * guessed: a wrong colour in ai_color_primary scores 3 points in the search
 * ranking, so inventing one is worse than leaving it null.
 */
const COLOR_WORDS = [
    'black', 'white', 'off white', 'red', 'maroon', 'blue', 'navy', 'green', 'olive',
    'yellow', 'orange', 'pink', 'purple', 'grey', 'gray', 'brown', 'beige', 'gold', 'silver',
];
const MATERIAL_WORDS = [
    'cotton', 'silk', 'linen', 'georgette', 'chiffon', 'muslin', 'jamdani', 'katan',
    'denim', 'polyester', 'viscose', 'rayon', 'leather', 'jute', 'canvas', 'velvet', 'wool',
];

const findWord = (haystack, words) => words.find((w) => haystack.includes(w)) || null;

const deriveAttributesFromText = (product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variantColor = variants.find((v) => v && (v.color || v.option === 'Color'));

    const haystack = [
        product.name, product.name_bn, product.category, product.description,
        (product.tags || []).join(' '),
    ].filter(Boolean).join(' ').toLowerCase();

    return {
        category: product.category || null,
        color_primary: (variantColor && (variantColor.color || variantColor.value))
            || findWord(haystack, COLOR_WORDS),
        material: findWord(haystack, MATERIAL_WORDS),
        style: null,
        tags: product.tags || [],
        description: product.description || null,
        search_text: haystack,
    };
};

/** Vision attribute extraction. Only reachable when AI_VISION_ENABLED=true. */
const extractAttributesFromImage = async (product, primaryImageUrl) => {
    const { text: rawJson } = await llmService.chat({
        systemPrompt: ATTRIBUTE_EXTRACTION_PROMPT,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'image_url', url: primaryImageUrl },
                    {
                        type: 'text',
                        text: `Product name: "${product.name}". Analyze the image and return JSON attributes.`
                    }
                ]
            }
        ],
        // Gemini is primary for every AI operation; it is multimodal, so the old
        // preferredProvider:'openai' override here was the only path in the repo
        // that made OpenAI a primary provider. Removed — the standard chain applies.
        maxTokens: 300
    });

    return parseAttributesJson(rawJson);
};

/**
 * Queue a product for async AI processing after create/update.
 * Fire-and-forget — does not block the response.
 */
const queueProductProcessing = (productId, shopId) => {
    setImmediate(async () => {
        try {
            const ok = await processProduct(productId, shopId);
            if (ok) console.log(`[ProductAI] Processed product ${productId}`);
        } catch (err) {
            console.error(`[ProductAI] Background processing error for ${productId}:`, err.message);
        }
    });
};

/**
 * Process all products for a shop that haven't been AI-analyzed yet.
 * Used for initial setup or after adding new products in bulk.
 *
 * @param {string} shopId
 * @param {number} limit  - max products to process in one run (default 50)
 */
const processPendingProducts = async (shopId, limit = 50) => {
    const { Op } = require('sequelize');
    const pending = await Product.findAll({
        where: {
            shop_id: shopId,
            ai_processed_at: null,
            is_active: true
        },
        limit,
        order: [['created_at', 'DESC']]
    });

    let processed = 0;
    for (const product of pending) {
        const ok = await processProduct(product.id, shopId);
        if (ok) processed++;
        // Small delay to avoid hammering vision API
        await new Promise(r => setTimeout(r, 200));
    }

    return { total: pending.length, processed };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parseAttributesJson = (raw) => {
    try {
        // Strip markdown fences if present
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
    } catch {
        // Try to extract JSON object from response
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
            try { return JSON.parse(match[0]); } catch { return null; }
        }
        return null;
    }
};

module.exports = {
    processProduct,
    queueProductProcessing,
    processPendingProducts,
    deriveAttributesFromText,
};
