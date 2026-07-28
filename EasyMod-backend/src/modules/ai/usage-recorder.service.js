'use strict';

/**
 * AI usage accounting — minimal, production-safe, OFF BY DEFAULT.
 *
 * Enable with AI_USAGE_ACCOUNTING=true. While the flag is unset every entry
 * point is a cheap no-op, so wiring it into the reply path cannot change
 * production behaviour.
 *
 * Sink: one structured log line per call (`ai_usage` event). No new table, no
 * migration, no extra round-trip on the hot path — the log pipeline already
 * exists and a cost ledger is append-only by nature. Promote to a table only if
 * per-shop cost queries become a product feature.
 *
 * SAFETY INVARIANTS (asserted by tests):
 *   - NEVER records prompt bodies, customer message text, replies, or FAQ text.
 *     Only counts, ids, and model names.
 *   - NEVER records secrets, tokens, phone numbers, or customer identifiers.
 *   - Idempotent on requestId, so a BullMQ retry or a duplicate webhook cannot
 *     double-count.
 *   - Records estimated cost and provider-confirmed usage separately via
 *     `sourceOfUsage`; a call with no usage metadata is recorded with
 *     estimatedCostUsd: null, never 0.
 *   - Can never throw into the caller.
 */

const { calculateCost, normalizeProviderUsage, USAGE_SOURCE } = require('./cost.service');

const ENABLED = () => process.env.AI_USAGE_ACCOUNTING === 'true';

const IDEMPOTENCY_TTL_SECONDS = parseInt(process.env.AI_USAGE_IDEMPOTENCY_TTL || '86400', 10);

// Fallback guard for when Redis is unavailable. Bounded so it cannot leak.
// ponytail: bounded Set, not an LRU — a per-process cap is enough for a
// best-effort dedupe backstop; move to Redis-only if the cap starts evicting hot keys.
const SEEN = new Set();
const SEEN_MAX = 5000;

let redis = null;
try {
    ({ cacheRedis: redis } = require('../../config/redis'));
} catch (_) { /* Redis unavailable — fall back to the in-process guard */ }

/** True the FIRST time a requestId is seen; false on every repeat. */
async function claimOnce(requestId) {
    if (!requestId) return true; // nothing to dedupe on — record it
    const key = `ai_usage:seen:${requestId}`;
    if (redis) {
        try {
            const res = await redis.set(key, '1', 'NX', 'EX', IDEMPOTENCY_TTL_SECONDS);
            return res === 'OK' || res === 1;
        } catch (_) { /* fall through to the in-process guard */ }
    }
    if (SEEN.has(key)) return false;
    if (SEEN.size >= SEEN_MAX) SEEN.clear();
    SEEN.add(key);
    return true;
}

/**
 * Record one AI call.
 *
 * @param {object} rec
 * @param {string}  rec.shopId
 * @param {string}  rec.operationType   'chat_reply'|'vision_extract'|'sentiment'|'product_attrs'|'embed_product'|'embed_query'|'transliterate'|'payment_ocr'
 * @param {string}  rec.provider        'gemini-lite'|'gemini-pro'|'openai'|'local'
 * @param {string}  rec.model
 * @param {string}  [rec.requestId]     idempotency key (message id, product id + revision, ...)
 * @param {string}  [rec.conversationId]
 * @param {string}  [rec.messageId]
 * @param {string}  [rec.productId]
 * @param {object}  [rec.responseBody]  raw provider body — usage is extracted, body is discarded
 * @param {object}  [rec.usage]         pre-normalised usage (when no raw body is available)
 * @param {number}  [rec.retrySequence] 0 for the first attempt
 * @param {number}  [rec.fallbackSequence] 0 = primary provider, 1 = second, 2 = third
 * @param {number}  [rec.imageCount]
 * @param {number}  [rec.latencyMs]
 * @param {boolean} [rec.success]
 */
async function recordUsage(rec = {}) {
    if (!ENABLED()) return null;

    try {
        if (!(await claimOnce(rec.requestId))) return null;

        const usage = rec.usage
            || normalizeProviderUsage(providerFamily(rec.provider), rec.responseBody)
            || null;

        const cost = usage
            ? calculateCost({
                model: rec.model,
                inputTokens: usage.inputTokens,
                cachedInputTokens: usage.cachedInputTokens,
                outputTokens: usage.outputTokens,
                reasoningTokens: usage.reasoningTokens,
                embeddingTokens: usage.embeddingTokens,
            })
            : null;

        const record = {
            event: 'ai_usage',
            timestamp: new Date().toISOString(),
            shopId: rec.shopId || null,
            operationType: rec.operationType || null,
            provider: rec.provider || null,
            model: rec.model || null,
            requestId: rec.requestId || null,
            conversationId: rec.conversationId || null,
            messageId: rec.messageId || null,
            productId: rec.productId || null,
            inputTokens: usage?.inputTokens ?? null,
            cachedInputTokens: usage?.cachedInputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            reasoningTokens: usage?.reasoningTokens ?? null,
            embeddingTokens: usage?.embeddingTokens ?? null,
            imageCount: rec.imageCount ?? 0,
            imageTokens: usage?.imageTokens ?? null,
            retrySequence: rec.retrySequence ?? 0,
            fallbackSequence: rec.fallbackSequence ?? 0,
            latencyMs: rec.latencyMs ?? null,
            success: rec.success !== false,
            // Unknown cost stays null. Zero would understate the ledger.
            estimatedCostUsd: cost?.costUsd ?? null,
            costUnknownReason: cost?.reason ?? (usage ? null : 'no_usage_metadata'),
            sourceOfUsage: usage?.sourceOfUsage ?? null,
            pricingVersion: cost?.pricingVersion ?? null,
        };

        // Single structured line. Deliberately console.log, matching how the rest
        // of the worker emits machine-readable events into the container log.
        console.log(JSON.stringify(record));
        return record;
    } catch (_) {
        // Accounting must never break a customer reply.
        return null;
    }
}

/** Map the internal provider label onto the usage-shape family. */
function providerFamily(provider) {
    return provider === 'openai' ? 'openai' : 'gemini';
}

module.exports = { recordUsage, USAGE_SOURCE, isEnabled: ENABLED };
