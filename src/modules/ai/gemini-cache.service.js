/**
 * Gemini Context Cache Service
 *
 * Caches the per-shop system prompt as a Gemini `cachedContent` resource.
 * Cache hits cost 75% less on input tokens; writes cost 2× for the first
 * request then pay off on the second request onwards.
 *
 * The cache entry lives for GEMINI_CACHE_TTL_SECONDS (default: 3600s / 1h).
 * A Redis key `gemini_cache:{shopId}:{promptHash}` stores the cachedContent
 * name so we don't re-create it on every request.
 *
 * Minimum cacheable size: ~1,024 tokens. Prompts shorter than this are
 * silently skipped (returns null) and the caller sends the full systemPrompt.
 *
 * Environment variables:
 *   GEMINI_API_KEY            — required
 *   GEMINI_CACHE_TTL_SECONDS  — TTL passed to Gemini (default: 3600)
 *   GEMINI_CACHE_MIN_CHARS    — min chars before attempting to cache (default: 800)
 */

const crypto = require('crypto');

const GEMINI_CACHE_TTL  = parseInt(process.env.GEMINI_CACHE_TTL_SECONDS || '3600', 10);
const GEMINI_MIN_CHARS  = parseInt(process.env.GEMINI_CACHE_MIN_CHARS || '800', 10);
const GEMINI_BASE_URL   = 'https://generativelanguage.googleapis.com/v1beta';

// Redis client — reuse the shared cache client used elsewhere in the app.
// Falls back to a no-op store when Redis is unavailable so the service
// degrades gracefully (no caching, but no errors either).
let redis = null;
try {
    ({ cacheRedis: redis } = require('../../config/redis'));
} catch (_) { /* Redis unavailable — operate without cache */ }

const _redisGet = async (key) => {
    try { return redis ? await redis.get(key) : null; } catch { return null; }
};
const _redisSetex = async (key, ttl, value) => {
    try { if (redis) await redis.setex(key, ttl, value); } catch { /* ignore */ }
};
const _redisDel = async (key) => {
    try { if (redis) await redis.del(key); } catch { /* ignore */ }
};

/**
 * Return a stable short hash of the system prompt string.
 * Used as part of the Redis key so stale cache entries auto-expire
 * when the shop's FAQ/branding changes.
 */
const _promptHash = (prompt) =>
    crypto.createHash('md5').update(prompt).digest('hex').slice(0, 12);

/**
 * Create a Gemini cachedContent from a system prompt string.
 *
 * @param {string} systemPrompt
 * @param {string} model        - Gemini model id (e.g. 'gemini-2.0-flash')
 * @returns {Promise<string|null>} cachedContent name, or null on failure
 */
const _createCachedContent = async (systemPrompt, model) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) return null;

    try {
        const res = await fetch(`${GEMINI_BASE_URL}/cachedContents?key=${apiKey}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model:             `models/${model}`,
                systemInstruction: { parts: [{ text: systemPrompt }] },
                ttl:               `${GEMINI_CACHE_TTL}s`,
                // Gemini requires at least one content turn; send a placeholder
                contents: [{ role: 'user', parts: [{ text: '.' }] }],
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            // 400 with "tokens less than minimum" means prompt is too short — not an error
            if (res.status === 400 && errText.includes('minimum')) return null;
            console.warn(`[GeminiCache] Create failed ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }

        const data = await res.json();
        return data?.name || null;
    } catch (err) {
        console.warn(`[GeminiCache] Create error: ${err.message}`);
        return null;
    }
};

/**
 * Get or create a cachedContent for the given shop + system prompt.
 * Returns the cachedContent name (e.g. "cachedContents/abc123") for use
 * in subsequent generateContent requests, or null when caching is skipped.
 *
 * @param {string} shopId
 * @param {string} systemPrompt
 * @param {string} [model]       - Gemini model (default: GEMINI_DEFAULT_MODEL env or gemini-2.0-flash)
 * @returns {Promise<string|null>}
 */
const getOrCreate = async (shopId, systemPrompt, model) => {
    // Skip for very short prompts — Gemini won't accept them and the cost
    // saving is negligible on small prompts anyway.
    if (!systemPrompt || systemPrompt.length < GEMINI_MIN_CHARS) return null;

    const geminiModel = model || process.env.LLM_DEFAULT_MODEL_GEMINI || 'gemini-2.0-flash';
    const hash = _promptHash(systemPrompt);
    const redisKey = `gemini_cache:${shopId}:${hash}`;

    // 1. Check Redis for an existing cachedContent name
    const cached = await _redisGet(redisKey);
    if (cached) return cached;

    // 2. Create a new cachedContent via Gemini API
    const name = await _createCachedContent(systemPrompt, geminiModel);
    if (!name) return null;

    // 3. Store in Redis with a margin below the Gemini TTL so we re-create
    //    before the Gemini entry expires.
    const redisTtl = Math.max(60, GEMINI_CACHE_TTL - 120);
    await _redisSetex(redisKey, redisTtl, name);

    return name;
};

/**
 * Invalidate the cached system prompt for a shop (call when FAQs change).
 *
 * @param {string} shopId
 */
const invalidate = async (shopId) => {
    try {
        if (!redis) return;
        const pattern = `gemini_cache:${shopId}:*`;
        const keys = await redis.keys(pattern);
        if (keys.length > 0) await redis.del(...keys);
    } catch { /* ignore */ }
};

module.exports = { getOrCreate, invalidate };
