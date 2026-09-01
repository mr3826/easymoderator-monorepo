'use strict';

/**
 * Meta Webhook — Entry Point Router
 *
 * Responsibilities (this file only):
 *   1. Redis-backed rate limiter on all webhook routes
 *   2. HMAC-SHA256 signature verification on POST /
 *   3. GET / — webhook verification challenge response
 *   4. POST / — dispatcher: routes Facebook Page events to the page handler
 *   5. Mount GDPR sub-router (data-deletion + deauthorize)
 *
 * All business logic has been extracted to:
 *   - meta-webhook-events.handler.js  (message storage, SSE, AI dispatch)
 *   - meta-webhook-gdpr.handler.js    (data-deletion, deauthorize)
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const config = require('../../config/config');
const { createLogger } = require('../../utils/structured-logger');
const { handlePageWebhook, storeIncomingMessage } = require('./meta-webhook-events.handler');
const { resolveConnectedChannel } = require('./meta-channel-resolver');
const { recordMalformedWebhook, MALFORMED_WEBHOOK_CODES } = require('./meta-webhook-metrics');
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
    if (typeof signature !== 'string' || !signature.startsWith('sha256=') || !secret) return false;
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
};

const malformedEnvelopeCode = (payload) => {
    const isRecord = (value) => Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value);
    const messagingEventFields = [
        'message',
        'optin',
        'delivery',
        'read',
        'postback',
        'reaction',
        'referral',
        'account_linking',
    ];

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return MALFORMED_WEBHOOK_CODES.INVALID_ENVELOPE;
    }
    if (typeof payload.object !== 'string' || !Array.isArray(payload.entry)) {
        return MALFORMED_WEBHOOK_CODES.INVALID_ENVELOPE;
    }

    for (const entry of payload.entry) {
        if (!isRecord(entry)) {
            return MALFORMED_WEBHOOK_CODES.INVALID_ENVELOPE;
        }
        if (payload.object !== 'page') continue;
        if (typeof entry.id !== 'string' || entry.id.trim() === '') {
            return MALFORMED_WEBHOOK_CODES.INVALID_ENVELOPE;
        }
        const hasEventCollection = ['messaging', 'changes', 'standby']
            .some((field) => Array.isArray(entry[field]));
        if (!hasEventCollection) return MALFORMED_WEBHOOK_CODES.INVALID_ENVELOPE;
        if (entry.messaging !== undefined && (!Array.isArray(entry.messaging)
            || entry.messaging.some((event) => !isRecord(event)
                || !messagingEventFields.some((field) => (
                    Object.prototype.hasOwnProperty.call(event, field)
                    && isRecord(event[field])
                ))))) {
            return MALFORMED_WEBHOOK_CODES.INVALID_ENVELOPE;
        }
        if (entry.changes !== undefined && (!Array.isArray(entry.changes)
            || entry.changes.some((change) => !isRecord(change)))) {
            return MALFORMED_WEBHOOK_CODES.INVALID_ENVELOPE;
        }
        if (entry.standby !== undefined && (!Array.isArray(entry.standby)
            || entry.standby.some((event) => !isRecord(event)))) {
            return MALFORMED_WEBHOOK_CODES.INVALID_ENVELOPE;
        }
    }
    return null;
};

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

router.post('/', express.raw({ type: '*/*', limit: config.bodySizeLimit }), async (req, res) => {
    try {
        const rawBody = req.body instanceof Buffer
            ? req.body
            : Buffer.from(req.body == null ? '' : String(req.body));
        const signature = req.headers['x-hub-signature-256'];
        const appSecret = config.metaAppSecret || config.metaWebhookAppSecret;
        const signatureValid = Boolean(appSecret && isValidSignature(rawBody, signature, appSecret));

        // Authenticate the exact bytes before attempting to parse attacker input.
        if (!signatureValid) {
            return res.sendStatus(403);
        }

        let payload;
        try {
            payload = JSON.parse(rawBody.toString('utf8'));
        } catch (_) {
            recordMalformedWebhook({
                rawBody,
                signatureValid: true,
                code: MALFORMED_WEBHOOK_CODES.INVALID_JSON,
            });
            return res.sendStatus(200);
        }

        const envelopeErrorCode = malformedEnvelopeCode(payload);
        if (envelopeErrorCode) {
            recordMalformedWebhook({
                rawBody,
                signatureValid: true,
                code: envelopeErrorCode,
            });
            return res.sendStatus(200);
        }

        const firstAssetId = payload.entry?.[0]?.id;

        logger.info(`Received ${payload.object} event for asset ${firstAssetId}`);

        if (payload.object === 'page') {
            await handlePageWebhook(payload, resolveConnectedChannel);
        } else {
            logger.warn(`Unhandled object type: ${payload.object}`);
        }

        res.sendStatus(200);
    } catch (error) {
        // The ONLY case where Meta must retry: we failed to write the durable
        // receipt, so no record of the event exists anywhere. Acknowledging here
        // would destroy a real customer message. Everything else is already
        // durably recorded and retried by the reconciler, so it acks 200.
        if (error?.name === 'WebhookReceiptPersistenceError') {
            logger.error('Durable webhook receipt persistence failed — asking Meta to redeliver', {
                errorCode: error.cause?.name || 'UnknownError',
            });
            return res.sendStatus(503);
        }

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
// The reconciler replays held receipts through the same resolution path the live
// webhook uses, so a retry can never resolve a Page differently from a delivery.
module.exports.resolveConnectedChannel = resolveConnectedChannel;
