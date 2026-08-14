/**
 * rateLimit rule
 *
 * Pre-flight check against the meta-send sliding-window counter. The actual
 * recording + ZSET pruning happens in MetaMessengerProvider.sendMessage
 * (one ZADD per real Graph API call, via keyFor() below so both sides always
 * agree on the key) — this rule is a non-mutating peek so the engine can deny
 * early without burning a send slot when over limit.
 *
 * Implementation: zcard against the `meta:sends:{pageId}` key. If at limit,
 * return DENY with retryAfterMs so the worker can move the job to a delayed
 * queue identically to the in-send path.
 *
 * Fails closed if Redis throws. A safety limit cannot be bypassed during a
 * Redis outage; callers should retry after the dependency is healthy.
 */

'use strict';

const { cacheRedis } = require('../../../config/redis');

const META_SEND_LIMIT = 170;
const WINDOW_MS = 60 * 60 * 1000;

function keyFor(pageId) {
    return `meta:sends:${pageId}`;
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
            const oldest = await cacheRedis.zrange(key, 0, 0, 'WITHSCORES');
            const oldestScore = oldest?.length >= 2 ? parseInt(oldest[1]) : now - WINDOW_MS;
            const retryAfterMs = Math.max(WINDOW_MS - (now - oldestScore), 1000);
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
