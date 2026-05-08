'use strict';

/**
 * Meta Send Service
 *
 * Handles:
 *   1. Sending replies to customers via Meta Graph API (Messenger/Instagram/WhatsApp)
 *   2. Leaky bucket rate limiting — tracks outbound messages per page using a Redis
 *      sliding-window ZSET. Conservative limit of 170/hr (Meta allows ~200/hr per token).
 *
 * Used by the BullMQ message worker. The worker catches MetaRateLimitError and
 * moves the job to a delayed state instead of failing it.
 */

const { cacheRedis } = require('../../config/redis');

const META_SEND_LIMIT = 170; // Per page access token per hour (conservative: Meta ~200)
const WINDOW_MS = 3_600_000; // 1 hour in ms

class MetaRateLimitError extends Error {
    constructor(retryAfterMs) {
        super(`Meta rate limit reached. Retry after ${Math.ceil(retryAfterMs / 1000)}s`);
        this.name = 'MetaRateLimitError';
        this.retryAfterMs = retryAfterMs;
    }
}

/**
 * Sliding-window rate limit check. Throws MetaRateLimitError when limit is reached.
 * Falls through silently if Redis is unavailable.
 */
async function checkAndRecord(pageId) {
    const key = `meta:sends:${pageId}`;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    try {
        // Prune entries older than the 1-hour window
        await cacheRedis.zremrangebyscore(key, '-inf', windowStart);
        const count = parseInt(await cacheRedis.zcard(key)) || 0;

        if (count >= META_SEND_LIMIT) {
            const oldest = await cacheRedis.zrange(key, 0, 0, 'WITHSCORES');
            const oldestScore = oldest?.length >= 2 ? parseInt(oldest[1]) : now - WINDOW_MS;
            const retryAfterMs = Math.max(WINDOW_MS - (now - oldestScore), 1000);
            throw new MetaRateLimitError(retryAfterMs);
        }

        // Record this send with a unique member (timestamp + random suffix avoids ZADD collisions)
        await cacheRedis.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
        await cacheRedis.expire(key, 3600);
    } catch (err) {
        if (err instanceof MetaRateLimitError) throw err;
        // Redis unavailable — rate limiting is bypassed. Log so ops can see it.
        console.error(`[meta-send] Redis rate-limit check failed for page ${pageId} — bypassing (${err.message})`);
    }
}

async function sendMetaReply(platform, accessToken, recipientId, messageText) {
    // Facebook Messenger or Instagram — Send API
    const res = await fetch('https://graph.facebook.com/v21.0/me/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: messageText },
            access_token: accessToken,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Messenger/Instagram send error ${res.status}: ${body}`);
    }
}

/**
 * High-level entry point: look up the shop's Meta integration, check rate limit,
 * decrypt the token, and send the reply.
 *
 * @param {object} params
 * @param {string} params.shopId
 * @param {string} params.platform — 'facebook' | 'messenger' | 'instagram'
 * @param {string} params.recipientId — Platform sender ID (customer's ID)
 * @param {string} params.message — Reply text
 */
async function sendWithRateLimit({ shopId, platform, recipientId, message }) {
    const MetaIntegration = require('./meta-integration.entity');
    const platformKey = (platform === 'facebook' || platform === 'messenger') ? 'facebook' : platform;

    const integration = await MetaIntegration.findOne({
        where: { shop_id: shopId, platform: platformKey, status: 'CONNECTED' },
    });

    if (!integration || !integration.access_token) {
        return;
    }

    if (integration.token_expires_at && new Date(integration.token_expires_at) < new Date()) {
        throw new Error(`Meta access token expired for shop ${shopId} (${platform}). Please reconnect the channel.`);
    }

    const pageId = integration.meta_asset_id;
    await checkAndRecord(pageId); // throws MetaRateLimitError if over limit

    const metaService = require('./meta.service');
    const accessToken = metaService.decryptToken(integration.access_token);
    await sendMetaReply(platform, accessToken, recipientId, message);

    console.log(`[meta-send] Sent ${platform} reply to ${recipientId} for shop ${shopId}`);
}

module.exports = { sendWithRateLimit, sendMetaReply, checkAndRecord, MetaRateLimitError };
