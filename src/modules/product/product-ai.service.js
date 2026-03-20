/**
 * Product AI Processing Service
 *
 * Processes product images with a vision LLM to generate search metadata.
 * These ai_* fields are for identification/search ONLY — never shown as
 * authoritative facts to customers (prices, stock, sizes always come from
 * live DB fields).
 *
 * Called:
 *  - After product create/update (async, non-blocking)
 *  - By background job for products where ai_processed_at IS NULL
 */

const Product = require('./product.entity');
const llmService = require('../ai/llm.service');

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
    if (!imageUrls.length) return false; // no images to process

    // Use first image for attribute extraction (most representative)
    const primaryImageUrl = imageUrls[0];

    try {
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
            preferredProvider: 'openai',  // GPT-4o-mini for vision
            skipProviders: ['deepseek'],
            maxTokens: 300
        });

        const attrs = parseAttributesJson(rawJson);
        if (!attrs) return false;

        // Build combined search text
        const searchParts = [
            product.name,
            product.name_bn,
            product.category,
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

        return true;
    } catch (err) {
        console.error(`[ProductAI] Failed to process product ${productId}:`, err.message);
        return false;
    }
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

module.exports = { processProduct, queueProductProcessing, processPendingProducts };
