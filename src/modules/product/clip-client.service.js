/**
 * CLIP Client — Tier 1 product image matcher
 *
 * HTTP client for the CLIP similarity microservice.
 * Used by ImageProductMatcher as the fastest matching tier
 * (perceptual + semantic hash via CLIP embeddings, ~10ms cache hit).
 *
 * On service unavailable, returns null and the caller falls through
 * to RAG (Tier 2) as before — no degradation for the customer.
 *
 * ENV:
 *   CLIP_SERVICE_URL       base URL (default: http://clip-similarity:8002)
 *   CLIP_TIMEOUT_MS        request timeout (default: 300ms)
 *   CLIP_SIMILARITY_THRESHOLD  min cosine score (default: 0.80)
 */

const axios = require('axios');

const BASE_URL = process.env.CLIP_SERVICE_URL || 'http://clip-similarity:8002';
const TIMEOUT = parseInt(process.env.CLIP_TIMEOUT_MS || '300', 10);
const THRESHOLD = parseFloat(process.env.CLIP_SIMILARITY_THRESHOLD || '0.80');

/**
 * Find the best-matching product for a customer image using CLIP.
 *
 * @param {string} imageUrl — customer-sent image URL
 * @param {Array<{id: string, shop_id: string}>} candidateProducts — products with cached embeddings
 * @returns {Promise<{
 *   matchedProductId: string|null,
 *   score: number,
 *   method: 'clip'
 * }|null>} — null if service unavailable or no match
 */
const findSimilarProduct = async (imageUrl, candidateProducts) => {
    if (!candidateProducts || candidateProducts.length === 0) return null;

    try {
        // Fetch cached embeddings for candidates
        const candidateEmbeddings = await Promise.all(
            candidateProducts.map(async (p) => {
                const { data } = await axios.post(
                    `${BASE_URL}/embed_image`,
                    { image_url: p.image_url },
                    { timeout: TIMEOUT }
                );
                return { product_id: p.id, embedding: data.embedding };
            })
        );

        const { data } = await axios.post(
            `${BASE_URL}/similarity`,
            {
                image_url: imageUrl,
                candidate_embeddings: candidateEmbeddings,
                threshold: THRESHOLD
            },
            { timeout: TIMEOUT }
        );

        if (!data.top_match) return null;

        return {
            matchedProductId: data.top_match,
            score: data.matches[0]?.score || 0,
            method: 'clip'
        };
    } catch (_) {
        return null; // Caller falls through to Tier 2 (RAG)
    }
};

/**
 * Pre-index a product's image into the CLIP service Redis cache.
 * Called fire-and-forget when a product image is saved.
 *
 * @param {string} productId
 * @param {string} shopId
 * @param {string} imageUrl
 */
const indexProductImage = async (productId, shopId, imageUrl) => {
    try {
        await axios.post(
            `${BASE_URL}/upsert_product`,
            { product_id: productId, shop_id: shopId, image_url: imageUrl },
            { timeout: 5000 }
        );
    } catch (_) {
        // Non-fatal — product still appears in RAG/Vision tiers
    }
};

/**
 * Remove a product's CLIP embedding cache entry on deletion.
 * @param {string} productId
 * @param {string} shopId
 */
const removeProductIndex = async (productId, shopId) => {
    try {
        await axios.delete(`${BASE_URL}/product/${shopId}/${productId}`, { timeout: 1000 });
    } catch (_) {}
};

/**
 * Health check.
 * @returns {Promise<boolean>}
 */
const isHealthy = async () => {
    try {
        const { data } = await axios.get(`${BASE_URL}/health`, { timeout: 1000 });
        return data.status === 'ok' && data.model_loaded === true;
    } catch (_) {
        return false;
    }
};

module.exports = { findSimilarProduct, indexProductImage, removeProductIndex, isHealthy };
