'use strict';

/**
 * Meta Webhook — Entry Point Router
 *
 * Responsibilities (this file only):
 *   1. Redis-backed rate limiter on all webhook routes
 *   2. HMAC-SHA256 signature verification on POST /
 *   3. GET / — webhook verification challenge response
 *   4. POST / — dispatcher: routes to page/instagram event handlers
 *   5. Mount GDPR sub-router (data-deletion + deauthorize)
 *
 * All business logic has been extracted to:
 *   - meta-webhook-events.handler.js  (message storage, SSE, AI dispatch)
 *   - meta-webhook-gdpr.handler.js    (data-deletion, deauthorize)
 *   - meta-webhook-comments.handler.js (comment-to-DM dispatch helpers)
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const config = require('../../config/config');
const metaChannelService = require('../channel-providers/meta-channel.service');
const { createLogger } = require('../../utils/structured-logger');
const { handlePageWebhook, handleInstagramWebhook, storeIncomingMessage } = require('./meta-webhook-events.handler');
const gdprRouter = require('./meta-webhook-gdpr.handler');

const logger = createLogger('MetaWebhook');

const router = express.Router();

// ─── Rate limiter (Redis-backed, MemoryStore fallback) ────────────────────────

const buildWebhookStore = () => {
    try {
        const { rateLimitRedis } = require('../../config/redis');
        if (rateLimitRedis && typeof rateLimitRedis.call === 'function') {
            return new RedisStore({ prefix: 'rl:webhook:', sendCommand: (...args) => rateLimitRedis.call(...args) });
        }
    } catch (_) { /* fall through */ }
    return undefined;
};

const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    store: buildWebhookStore()
});

router.use(webhookLimiter);

// ─── Signature verification helper ───────────────────────────────────────────

const isValidSignature = (rawBody, signature, secret) => {
    if (!signature || !secret) return false;
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
};

// ─── Channel resolver ─────────────────────────────────────────────────────────

/**
 * Resolve the connected channel for an incoming Meta asset ID.
 * Phase 5: reads exclusively from meta_channels (single source of truth).
 */
async function resolveConnectedChannel(assetId, platform) {
    const channel = await metaChannelService.findByMetaAssetId(assetId);
    if (!channel) return null;
    // Only treat genuinely-connected channels as routable. A DISCONNECTED /
    // TOKEN_EXPIRED / REVOKED channel can never send a reply, so dispatching an
    // AI job just burns quota and produces a reply that fails at send. Returning
    // null here routes into the handler's null-branch, which notifies the owner
    // (via SSE) to reconnect the channel.
    if (channel.status !== 'CONNECTED') return null;
    return {
        id: channel.id,
        shop_id: channel.shop_id,
        platform: channel.platform,
        asset_id: channel.meta_asset_id,
        display_name: channel.display_name,
        status: channel.status,
        source: 'meta_channels',
    };
}

// ─── GET / — webhook verification challenge ──────────────────────────────────

router.get('/', async (req, res) => {
    const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': verifyToken } = req.query;

    if (mode !== 'subscribe' || !verifyToken) {
        return res.sendStatus(403);
    }

    // Path 1 — global App Dashboard verify token. This is what Meta sends when
    // the founder clicks "Verify and Save" in the App Dashboard webhook config.
    // Constant-time compare so a length / content side-channel can't be used to
    // brute-force the token.
    const globalToken = config.metaWebhookVerifyToken;
    if (globalToken) {
        try {
            const a = Buffer.from(verifyToken);
            const b = Buffer.from(globalToken);
            if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
                return res.status(200).send(challenge);
            }
        } catch (_) { /* fall through to per-channel lookup */ }
    }

    // Path 2 — per-channel verify token (Phase-1 artefact, retained for any
    // legacy direct subscriptions that still use it).
    try {
        const MetaChannel = require('../channel-providers/meta-channel.entity');
        const channel = await MetaChannel.findOne({
            where: { webhook_verify_token: verifyToken, status: 'CONNECTED' }
        });

        if (channel) {
            return res.status(200).send(challenge);
        }
        return res.sendStatus(403);
    } catch (err) {
        logger.error('Webhook verify token lookup error', { error: err.message });
        return res.sendStatus(500);
    }
});

// ─── POST / — webhook receiver + dispatcher ───────────────────────────────────

router.post('/', express.raw({ type: '*/*' }), async (req, res) => {
    try {
        const signature = req.headers['x-hub-signature-256'];

        let payload;
        try {
            const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
            payload = rawBody ? JSON.parse(rawBody) : {};
        } catch (parseErr) {
            logger.error('Payload JSON parse error', { error: parseErr.message });
            return res.sendStatus(200);
        }

        const firstAssetId = payload.entry?.[0]?.id;

        const appSecret = config.metaWebhookAppSecret;
        if (appSecret) {
            const rawBodyBuf = req.body instanceof Buffer ? req.body : Buffer.from(String(req.body || ''));
            const isValid = isValidSignature(rawBodyBuf, signature, appSecret);
            if (!isValid) {
                logger.error(`Invalid signature for asset ${firstAssetId} — check META_WEBHOOK_APP_SECRET matches your Meta App Secret exactly`);
                return res.sendStatus(403);
            }
        } else {
            logger.error('META_WEBHOOK_APP_SECRET not configured — rejecting webhook to prevent unauthenticated payload injection');
            return res.sendStatus(403);
        }

        logger.info(`Received ${payload.object} event for asset ${firstAssetId}`);

        if (payload.object === 'page') {
            await handlePageWebhook(payload, resolveConnectedChannel);
        } else if (payload.object === 'instagram') {
            await handleInstagramWebhook(payload, resolveConnectedChannel);
        } else {
            logger.warn(`Unhandled object type: ${payload.object}`);
        }

        res.sendStatus(200);
    } catch (error) {
        const isExpected =
            error.name === 'SequelizeUniqueConstraintError' ||
            error.message?.includes('duplicate') ||
            error.message?.includes('unknown sender');

        if (isExpected) {
            logger.warn('Expected webhook processing error (duplicate/unknown)', { error: error.message });
        } else {
            logger.error('UNEXPECTED webhook processing error', { error: error.message, stack: error.stack, name: error.name });
        }

        res.sendStatus(200);
    }
});

// ─── GDPR sub-router ──────────────────────────────────────────────────────────

router.use('/', gdprRouter);

// Export storeIncomingMessage so the channel test endpoint can use it directly
module.exports = router;
module.exports.storeIncomingMessage = storeIncomingMessage;
