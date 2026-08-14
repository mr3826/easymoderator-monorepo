/**
 * rateLimit rule
 *
 * Pre-flight check against the meta-send sliding-window counter. This is a
 * non-mutating peek so the engine can deny early (before storing a draft
 * reply, fetching tokens, etc.) without touching the counter — the real,
 * atomic admission gate is reserveSendSlot() below, which
 * MetaMessengerProvider.sendMessage calls once per actual Graph API call
 * (a single logical message can fan out into several real sends — text +
 * N attachments — so the gate has to live at that granularity, not here).
 *
 * Implementation: zcard against the `meta:sends:{pageId}` key. If at limit,
 * return DENY with retryAfterMs so the worker can move the job to a delayed
 * queue identically to the in-send path.
 *
 * Fails closed if Redis throws. A safety limit cannot be bypassed during a
 * Redis outage; callers should retry after the dependency is healthy.
 */

'use strict';

const crypto = require('crypto');
const { cacheRedis } = require('../../../config/redis');

const META_SEND_LIMIT = 170;
const WINDOW_MS = 60 * 60 * 1000;

function keyFor(pageId) {
    return `meta:sends:${pageId}`;
}

// Atomic prune + count + conditional-reserve in one Redis round trip, so two
// concurrent sends can never both observe "under limit" and both proceed —
// exactly the race a separate zcard-then-later-zadd allows.
const RESERVE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  return 1
else
  return 0
end
`;

async function computeRetryAfterMs(key, now) {
    const oldest = await cacheRedis.zrange(key, 0, 0, 'WITHSCORES');
    const oldestScore = oldest?.length >= 2 ? parseInt(oldest[1]) : now - WINDOW_MS;
    return Math.max(WINDOW_MS - (now - oldestScore), 1000);
}

// Atomically reserves one send slot for pageId, or denies with a backoff
// hint. Call immediately before the Graph API POST it protects; on send
// failure, release the reservation via releaseSendSlot so a send Meta never
// received doesn't permanently consume quota.
async function reserveSendSlot(pageId) {
    if (!pageId) return { allowed: true };
    const key = keyFor(pageId);
    const now = Date.now();
    const member = `${now}-${crypto.randomUUID()}`;
    try {
        const reserved = await cacheRedis.eval(RESERVE_SCRIPT, 1, key, now, WINDOW_MS, META_SEND_LIMIT, member);
        if (reserved === 1) {
            return { allowed: true, member };
        }
        return { allowed: false, retryAfterMs: await computeRetryAfterMs(key, now) };
    } catch (err) {
        // Fail closed: a Redis outage must not silently bypass the limiter.
        return { allowed: false, retryAfterMs: 30_000, error: err.message };
    }
}

async function releaseSendSlot(pageId, member) {
    if (!member) return;
    try {
        await cacheRedis.zrem(keyFor(pageId), member);
    } catch (err) {
        // Best-effort — a failed release just means the slot self-expires
        // out of the window after WINDOW_MS instead of immediately.
    }
}

module.exports = {
    name: 'rateLimit',

    async evaluate(_message, ctx) {
        const pageId = ctx.channel?.meta_asset_id;
        if (!pageId) return { allow: true, reason: 'NO_CHANNEL' };

        try {
            const key = keyFor(pageId);
            const now = Date.now();
            await cacheRedis.zremrangebyscore(key, '-inf', now - WINDOW_MS);
            const count = parseInt(await cacheRedis.zcard(key)) || 0;
            if (count < META_SEND_LIMIT) {
                return { allow: true, reason: 'UNDER_LIMIT', augment: { rate_count: count } };
            }
            const retryAfterMs = await computeRetryAfterMs(key, now);
            return {
                allow: false,
                reason: 'RATE_LIMIT',
                retryAfterMs,
                augment: { rate_count: count, retry_after_ms: retryAfterMs },
            };
        } catch (err) {
            return { allow: false, reason: 'RATE_LIMIT_UNAVAILABLE', retryAfterMs: 30_000 };
        }
    },
};

module.exports.META_SEND_LIMIT = META_SEND_LIMIT;
module.exports.keyFor = keyFor;
module.exports.reserveSendSlot = reserveSendSlot;
module.exports.releaseSendSlot = releaseSendSlot;
