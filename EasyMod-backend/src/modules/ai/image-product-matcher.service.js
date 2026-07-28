/**
 * ImageProductMatcher
 *
 * Handles the dominant F-commerce inbox entry point:
 *   Customer sends a product photo + Banglish text ("bhaiya eita available?")
 *
 * Three-tier matching strategy (cheapest → most expensive):
 *   1. Image hash   — perceptual hash match vs. product catalog images (~0ms)
 *                     Falls back if no hash match above threshold
 *   2. Vector RAG   — semantic search via embeddings in Qdrant (~30ms)
 *                     Uses Banglish-normalised text + Gemini Vision description
 *   3. Gemini Vision — full image description → text search (~1s, costs money)
 *                     Only triggered when tiers 1 & 2 return nothing useful
 *
 * Returns the matched Product(s) with live stock from StockStatusGuard,
 * ready to inject into the LLM system prompt as grounded product context.
 *
 * ENV:
 *   IMAGE_MATCH_HASH_THRESHOLD   perceptual hash distance threshold (default: 10)
 *   IMAGE_MATCH_RAG_THRESHOLD    min RAG cosine score (default: 0.72)
 *   IMAGE_MATCH_MAX_RESULTS      max products returned (default: 3)
 */

const llmService = require('./llm.service');
const { queryData } = require('../rag/rag.service');
const { searchByAttributes, getProductsByIds } = require('../product/product-search.service');
const { findSimilarProduct } = require('../product/clip-client.service');
const { visionEnabled } = require('./vision-policy.service');

const RAG_THRESHOLD   = parseFloat(process.env.IMAGE_MATCH_RAG_THRESHOLD || '0.72');
const MAX_RESULTS     = parseInt(process.env.IMAGE_MATCH_MAX_RESULTS || '3', 10);

// ---------------------------------------------------------------------------
// Gemini Vision prompt — extract searchable product attributes from image
// ---------------------------------------------------------------------------
const VISION_DESCRIBE_PROMPT = `You are analyzing a product photo from a Bangladeshi e-commerce shop (F-commerce).
Return ONLY a JSON object (no markdown) with these fields:
{
  "category": "product type e.g. kurti/saree/shirt/panjabi/shoes/bag/jewelry",
  "color": "primary color in English e.g. red/blue/white/black",
  "material": "fabric or material e.g. cotton/silk/georgette (null if unclear)",
  "style": "e.g. printed/embroidered/plain/casual/formal (null if unclear)",
  "tags": ["up to 6 search keywords in English"],
  "description": "one short sentence describing the product for search"
}`;

// ---------------------------------------------------------------------------
// Tier 3: Gemini Vision description → attribute-based DB search
// ---------------------------------------------------------------------------
const matchViaVision = async (imageUrl, shopId) => {
    // Image understanding is off by default — see vision-policy.service.js.
    if (!visionEnabled()) {
        return { products: [], method: 'vision_disabled', attrs: null };
    }
    try {
        const { text: rawJson } = await llmService.chat({
            systemPrompt: VISION_DESCRIBE_PROMPT,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'image_url', url: imageUrl },
                        { type: 'text', text: 'Analyze this product image and return JSON.' }
                    ]
                }
            ],
            preferredProvider: 'gemini-lite',  // Gemini is primary + multimodal
            maxTokens: 200
        });

        // Parse JSON — tolerate markdown wrappers
        const json = rawJson.replace(/```(?:json)?/g, '').trim();
        const attrs = JSON.parse(json);

        const products = await searchByAttributes({
            shopId,
            category: attrs.category,
            color: attrs.color,
            material: attrs.material,
            query: attrs.description,
            tags: attrs.tags || [],
            limit: MAX_RESULTS
        });

        return { products, method: 'vision', attrs };
    } catch (err) {
        console.error('[ImageProductMatcher] Vision tier failed:', err.message);
        return { products: [], method: 'vision_failed', attrs: null };
    }
};

// ---------------------------------------------------------------------------
// Tier 2: RAG vector search using combined image description + text query
// ---------------------------------------------------------------------------
const matchViaRag = async (textQuery, shopId, visionAttrs = null) => {
    try {
        // Combine customer text + vision attributes into a richer query
        const parts = [textQuery];
        if (visionAttrs) {
            if (visionAttrs.category) parts.push(visionAttrs.category);
            if (visionAttrs.color) parts.push(visionAttrs.color);
            if (visionAttrs.description) parts.push(visionAttrs.description);
        }
        const query = parts.filter(Boolean).join(' ');
        if (!query.trim()) return { products: [], method: 'rag_skip' };

        const { results } = await queryData({ query, limit: MAX_RESULTS, shopId });
        const hits = results.filter(r => r.score >= RAG_THRESHOLD);

        // hits are vector store documents; fetch live product data for each
        const productIds = hits
            .map(h => h.metadata?.product_id)
            .filter(Boolean);

        if (!productIds.length) return { products: [], method: 'rag_nomatch' };

        const products = await getProductsByIds(productIds, shopId);

        return { products, method: 'rag', ragScores: hits.map(h => h.score) };
    } catch (err) {
        console.error('[ImageProductMatcher] RAG tier failed:', err.message);
        return { products: [], method: 'rag_failed' };
    }
};

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

/**
 * Match a customer's image+text message to catalog products.
 *
 * @param {object} params
 * @param {string} params.shopId
 * @param {string} [params.imageUrl]   — URL of customer-sent image (may be null for text-only)
 * @param {string} [params.text]       — customer message text (may be Banglish/Bengali/mixed)
 * @returns {Promise<{
 *   products: object[],    — matched Product records (live DB data)
 *   method: string,        — 'clip' | 'rag' | 'vision' | 'text_only' | 'no_match'
 *   confidence: number,    — 0.0–1.0
 * }>}
 */
const matchImageMessage = async ({ shopId, imageUrl, text = '' }) => {
    const queryText = text.toLowerCase().trim();

    // --- Text-only path (no image) ---
    if (!imageUrl) {
        const products = await searchByAttributes({
            shopId,
            query: text,
            limit: MAX_RESULTS
        });
        return {
            products,
            method: 'text_only',
            confidence: products.length ? 0.7 : 0.0
        };
    }

    // --- Tier 1: CLIP image similarity (fastest — ~10ms Redis hit) ---
    // CLIP is an image-embedding path; skipped with the rest of vision.
    if (visionEnabled()) {
        try {
            const candidates = await searchByAttributes({ shopId, query: '', limit: 50, withImages: true });
            if (candidates.length > 0) {
                const clipResult = await findSimilarProduct(imageUrl, candidates);
                if (clipResult && clipResult.matchedProductId) {
                    const matched = candidates.filter(p => p.id === clipResult.matchedProductId);
                    if (matched.length > 0) {
                        return {
                            products: matched,
                            method: 'clip',
                            confidence: clipResult.score
                        };
                    }
                }
            }
        } catch (_) {
            // CLIP unavailable — continue to Tier 2
        }
    }

    // --- Tier 2: RAG (using text query, possibly enhanced by light vision) ---
    let ragResult;
    let visionAttrs = null;

    if (queryText.length > 2) {
        ragResult = await matchViaRag(queryText, shopId);
        if (ragResult.products.length > 0) {
            return {
                products: ragResult.products,
                method: ragResult.method,
                confidence: 0.82
            };
        }
    }

    // --- Tier 3: Gemini Vision (only when RAG has nothing) ---
    const visionResult = await matchViaVision(imageUrl, shopId);
    visionAttrs = visionResult.attrs;

    if (visionResult.products.length > 0) {
        return {
            products: visionResult.products,
            method: visionResult.method,
            confidence: 0.75,
            visionAttrs
        };
    }

    // --- Tier 2 again with vision context (if text was sparse) ---
    if (visionAttrs) {
        ragResult = await matchViaRag('', shopId, visionAttrs);
        if (ragResult.products.length > 0) {
            return {
                products: ragResult.products,
                method: 'rag+vision',
                confidence: 0.70,
                visionAttrs
            };
        }
    }

    return {
        products: [],
        method: 'no_match',
        confidence: 0.0
    };
};

/**
 * Build the "no match" response message for the customer.
 * Asks them to clarify which product, with quick-reply hints.
 */
const buildNoMatchResponse = (shopName) =>
    `কোন পণ্যটির কথা বলছেন ভাই? ${shopName ? `${shopName}-এর` : 'আমাদের'} catalog থেকে বেছে নিন অথবা পণ্যের নাম লিখুন। 🛍️`;

module.exports = { matchImageMessage, buildNoMatchResponse };
