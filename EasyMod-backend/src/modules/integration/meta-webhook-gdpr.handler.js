'use strict';

/**
 * Meta GDPR Webhook Handlers
 *
 * Handles:
 *   GET  /webhooks/meta/data-deletion  — human-readable deletion instructions
 *   POST /webhooks/meta/data-deletion  — Meta Data Deletion Request Callback
 *   POST /webhooks/meta/deauthorize    — Meta Deauthorize Callback
 *
 * Both POST endpoints are required by Meta Platform Terms for Facebook Login apps.
 *
 * Spec:
 *   https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 *   https://developers.facebook.com/docs/development/create-an-app/app-dashboard/deauthorize-callback-url
 */

const crypto = require('crypto');
const express = require('express');
const { Customer } = require('../entities');
const config = require('../../config/config');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('MetaWebhookGdpr');

// ─── GDPR idempotency guard ──────────────────────────────────────────────────
let _gdprRedis = null;
function getGdprRedis() {
    if (_gdprRedis) return _gdprRedis;
    try {
        const { cacheRedis } = require('../../config/redis');
        if (cacheRedis && !cacheRedis._isMemoryFallback) {
            _gdprRedis = cacheRedis;
        }
    } catch (_) { /* Redis unavailable */ }
    return _gdprRedis;
}

const _gdprMemorySet = new Map();
function _memorySetHas(key) {
    const expiry = _gdprMemorySet.get(key);
    if (!expiry) return false;
    if (Date.now() > expiry) { _gdprMemorySet.delete(key); return false; }
    return true;
}
function _memorySetAdd(key, ttlSeconds) {
    _gdprMemorySet.set(key, Date.now() + ttlSeconds * 1000);
}

/**
 * Mark a GDPR job as processed (idempotency key with 24-hour TTL).
 * Returns true if this key was already processed (skip), false if first run.
 */
async function checkAndMarkGdprProcessed(type, userId) {
    const today = new Date().toISOString().slice(0, 10);
    const key = `gdpr:processed:${type}:${userId}:${today}`;
    const TTL = 86400;

    const redis = getGdprRedis();
    if (redis) {
        try {
            const result = await redis.set(key, '1', 'EX', TTL, 'NX');
            return result === null;
        } catch (err) {
            logger.warn('GDPR idempotency Redis check failed, proceeding', { error: err.message });
            return false;
        }
    }

    if (_memorySetHas(key)) return true;
    _memorySetAdd(key, TTL);
    return false;
}

// ─── Signed request parser ───────────────────────────────────────────────────

/**
 * Parse and verify Meta's signed_request parameter.
 * Returns the decoded payload or null if the signature is invalid.
 */
function parseSignedRequest(signedRequest, appSecret) {
    try {
        const [encodedSig, encodedPayload] = signedRequest.split('.');
        if (!encodedSig || !encodedPayload) return null;

        const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const expectedSig = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();

        if (!crypto.timingSafeEqual(sig, expectedSig)) return null;

        const payloadJson = Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        return JSON.parse(payloadJson);
    } catch {
        return null;
    }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

const router = express.Router();

/**
 * GET /webhooks/meta/data-deletion
 * Human-readable deletion instructions page.
 */
router.get('/data-deletion', (req, res) => {
    res.json({
        message: 'EasyModerator Data Deletion Instructions',
        instructions: [
            '1. Remove EasyModerator from your Facebook App Settings (Settings > Apps and Websites).',
            '2. Meta will automatically send a deletion request to our callback and we will delete your data within 30 days.',
            '3. Alternatively, email privacy@easymod.tech with subject "Facebook Data Deletion Request" and we will process it manually.',
            '4. You will receive a confirmation code by email once deletion is complete.'
        ],
        contact: 'privacy@easymod.tech'
    });
});

/**
 * POST /webhooks/meta/data-deletion
 * Meta Data Deletion Request Callback.
 */
router.post('/data-deletion', express.urlencoded({ extended: false }), async (req, res) => {
    try {
        const { signed_request: signedRequest } = req.body;
        if (!signedRequest) {
            return res.status(400).json({ error: 'Missing signed_request' });
        }

        const appSecret = config.metaAppSecret || config.metaWebhookAppSecret || process.env.META_APP_SECRET;
        if (!appSecret) {
            logger.error('Data deletion callback: META_APP_SECRET not configured');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const payload = parseSignedRequest(signedRequest, appSecret);
        if (!payload) {
            return res.status(403).json({ error: 'Invalid signed_request signature' });
        }

        const facebookUserId = payload.user_id;
        const confirmationCode = `DEL-${facebookUserId}-${Date.now()}`;

        const alreadyProcessed = await checkAndMarkGdprProcessed('deletion', facebookUserId);
        if (alreadyProcessed) {
            logger.info(`Data deletion callback: already processed for user ${facebookUserId} today`, { confirmationCode });
            const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://www.easymod.tech';
            return res.status(200).json({ url: `${baseUrl}/privacy-policy`, confirmation_code: confirmationCode });
        }

        const DELETION_TIMEOUT_MS = 25000;
        const deletionPromise = Customer.destroy({
            where: {
                channel_user_id: facebookUserId,
                channel_type: ['messenger', 'instagram']
            }
        });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Deletion timed out after 25s')), DELETION_TIMEOUT_MS)
        );

        try {
            const deletedCount = await Promise.race([deletionPromise, timeoutPromise]);
            logger.info(`Data deletion: deleted ${deletedCount} record(s) for user ${facebookUserId}`, { confirmationCode });
        } catch (deleteErr) {
            logger.error(`Data deletion: INCOMPLETE for user ${facebookUserId}`, {
                error: deleteErr.message, stack: deleteErr.stack, confirmationCode
            });
        }

        const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://www.easymod.tech';
        return res.status(200).json({
            url: `${baseUrl}/privacy-policy`,
            confirmation_code: confirmationCode
        });
    } catch (error) {
        logger.error('Data deletion callback error', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /webhooks/meta/deauthorize
 * Meta Deauthorize Callback.
 */
router.post('/deauthorize', express.urlencoded({ extended: false }), async (req, res) => {
    try {
        const { signed_request: signedRequest } = req.body;
        if (!signedRequest) {
            return res.status(400).json({ error: 'Missing signed_request' });
        }

        const appSecret = config.metaAppSecret || config.metaWebhookAppSecret || process.env.META_APP_SECRET;
        if (!appSecret) {
            logger.error('Deauthorize callback: META_APP_SECRET not configured');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const payload = parseSignedRequest(signedRequest, appSecret);
        if (!payload) {
            return res.status(403).json({ error: 'Invalid signed_request signature' });
        }

        const facebookUserId = payload.user_id;

        const alreadyProcessed = await checkAndMarkGdprProcessed('deauthorize', facebookUserId);
        if (alreadyProcessed) {
            logger.info(`Deauthorize: already processed for user ${facebookUserId} today`);
            return res.sendStatus(200);
        }

        const DEAUTH_TIMEOUT_MS = 25000;
        const updatePromise = Customer.update(
            { metadata: require('sequelize').literal(`jsonb_set(COALESCE(metadata, '{}'), '{deauthorized}', 'true')`) },
            {
                where: {
                    channel_user_id: facebookUserId,
                    channel_type: ['messenger', 'instagram']
                }
            }
        );
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Deauthorize update timed out after 25s')), DEAUTH_TIMEOUT_MS)
        );

        try {
            await Promise.race([updatePromise, timeoutPromise]);
            logger.info(`Deauthorize: marked customer ${facebookUserId} as deauthorized`);
        } catch (err) {
            logger.error(`Deauthorize: INCOMPLETE for user ${facebookUserId}`, {
                error: err.message, stack: err.stack
            });
        }

        return res.sendStatus(200);
    } catch (error) {
        logger.error('Deauthorize callback error', { error: error.message });
        return res.sendStatus(500);
    }
});

module.exports = router;
