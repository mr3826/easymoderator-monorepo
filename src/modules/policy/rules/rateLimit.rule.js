/**
 * rateLimit rule
 *
 * Pre-flight check against the meta-send sliding-window counter. The actual
 * recording + ZSET pruning still happens inside meta-send.service.checkAndRecord
 * during the real send call — this rule is a non-mutating peek so the engine
 * can deny early without burning a send slot when over limit.
 *
 * Implementation: zcard against the existing `meta:sends:{pageId}` key. If at
 * limit, return DENY with retryAfterMs so the worker can move the job to a
 * delayed queue identically to the in-send path.
 *
 * Falls open (allow) if Redis throws — the in-send path has its own enforcement
 * and we don't want a Redis blip to block all sends.
 */

'use strict';

const { cacheRedis } = require('../../../config/redis');

const META_SEND_LIMIT = 170;
const WINDOW_MS = 60 * 60 * 1000;

module.exports = {
    name: 'rateLimit',

    async evaluate(_message, ctx) {
        const pageId = ctx.channel?.meta_asset_id;
        if (!pageId) return { allow: true, reason: 'NO_CHANNEL' };

        try {
            const key = `meta:sends:${pageId}`;
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
            // Defense-in-depth: the in-send path also enforces. Fall open here.
            return { allow: true, reason: 'REDIS_UNAVAILABLE' };
        }
    },
};

module.exports.META_SEND_LIMIT = META_SEND_LIMIT;
