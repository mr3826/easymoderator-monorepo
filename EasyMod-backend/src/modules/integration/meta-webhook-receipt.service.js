'use strict';

/**
 * Durable inbound Meta webhook receipts (F-02 / F-03).
 *
 * Contract:
 *   1. Every messaging event gets a row BEFORE the webhook is acknowledged.
 *   2. If that write fails the caller must return a retryable 5xx so Meta
 *      redelivers — never a 200, which would destroy the only copy of the event.
 *   3. Every downstream outcome is recorded on the row: processed, skipped,
 *      identity unresolved, store failed, retry pending, dead-lettered.
 *   4. Nothing here logs or alerts with a message body, PSID, or token.
 */

const crypto = require('crypto');
const MetaWebhookReceipt = require('./meta-webhook-receipt.entity');
const { encryptPayload, decryptPayload } = require('../../utils/webhook-payload-cipher');
const { createLogger } = require('../../utils/structured-logger');
const { opsAlert } = require('../../utils/ops-alert');

const logger = createLogger('MetaWebhookReceipt');

/**
 * Retry ladders in minutes. Storage failures are usually transient, so they
 * retry fast and give up in hours. An unconnected Page is a human problem — the
 * merchant has to reconnect — so those events are held for ~3 days first.
 */
const STORE_RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const IDENTITY_RETRY_BACKOFF_MINUTES = [5, 15, 60, 240, 720, 1440, 1440];
const MAX_STORE_RETRIES = STORE_RETRY_BACKOFF_MINUTES.length;
const MAX_IDENTITY_RETRIES = IDENTITY_RETRY_BACKOFF_MINUTES.length;

/** A claim older than this is assumed abandoned (crashed runner) and reclaimed. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/** Retention — receipts are operational evidence, not an archive. */
const TERMINAL_RETENTION_DAYS = 7;
const DEAD_LETTER_RETENTION_DAYS = 30;

const RETRYABLE_STATUSES = ['RETRY_PENDING', 'MESSAGE_STORE_FAILED', 'IDENTITY_NOT_RESOLVED'];
const TERMINAL_STATUSES = ['PROCESSED', 'SKIPPED', 'DEAD_LETTERED'];

/** Thrown when the durable receipt itself cannot be written. */
class WebhookReceiptPersistenceError extends Error {
    constructor(cause) {
        super('Failed to persist inbound Meta webhook receipt');
        this.name = 'WebhookReceiptPersistenceError';
        this.cause = cause;
    }
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/**
 * Classify a raw `entry.messaging[]` element without retaining its content.
 * @returns {{eventType: string, eventId: string|null, senderRef: string|null}}
 */
function classifyEvent(messaging = {}) {
    const senderId = messaging.sender?.id;
    const senderRef = senderId ? sha256(senderId) : null;
    const eventId = messaging.message?.mid || null;

    let eventType = 'unknown';
    if (messaging.optin) eventType = 'optin';
    else if (messaging.message?.is_echo) eventType = 'echo';
    else if (messaging.message?.text || (messaging.message?.attachments || []).length > 0) eventType = 'message';
    else if (messaging.delivery) eventType = 'delivery';
    else if (messaging.read) eventType = 'read';

    return { eventType, eventId, senderRef };
}

/**
 * Persist one receipt. Idempotent on dedupe_key: a redelivered event returns the
 * existing row with `duplicate: true` instead of creating a second one.
 *
 * @throws {WebhookReceiptPersistenceError} when the row cannot be written.
 */
async function recordReceipt({ pageId, objectType = 'page', messaging }) {
    const { eventType, eventId, senderRef } = classifyEvent(messaging);
    const payloadHash = sha256(JSON.stringify(messaging ?? null));
    const dedupeKey = eventId || sha256(`${pageId}|${payloadHash}`);

    // Only events that can be replayed carry a body. Echoes, delivery and read
    // receipts are accounted for but never re-ingested, so they store nothing.
    const replayable = eventType === 'message' || eventType === 'optin';

    // A cipher failure must degrade, not reject: recording the event without a
    // replay body still preserves it as evidence, whereas throwing here would
    // 5xx every inbound webhook. Such a receipt dead-letters (PAYLOAD_MISSING)
    // if it ever needs replaying, so the loss is visible rather than silent.
    let payloadEncrypted = null;
    if (replayable) {
        try {
            payloadEncrypted = encryptPayload(messaging);
        } catch (cipherErr) {
            logger.error('Webhook replay payload could not be encrypted — receipt stored without it', {
                pageId: String(pageId),
                errorCode: cipherErr?.message === 'CHANNEL_ENCRYPTION_KEY is not set'
                    ? 'CHANNEL_ENCRYPTION_KEY_MISSING'
                    : 'CIPHER_ERROR',
            });
            opsAlert('Meta webhook — replay payload encryption unavailable', {
                detail: 'Inbound events are being recorded without a replay body, so a storage '
                    + 'failure cannot be retried automatically. Check CHANNEL_ENCRYPTION_KEY.',
                level: 'error',
                context: { pageId: String(pageId) },
            }).catch(() => {});
        }
    }

    try {
        const existing = await MetaWebhookReceipt.findOne({ where: { dedupe_key: dedupeKey } });
        if (existing) return { receipt: existing, duplicate: true };

        const receipt = await MetaWebhookReceipt.create({
            provider: 'meta',
            object_type: objectType,
            page_id: String(pageId),
            event_id: eventId,
            dedupe_key: dedupeKey,
            event_type: eventType,
            sender_ref: senderRef,
            payload_hash: payloadHash,
            payload_encrypted: payloadEncrypted,
            status: 'RECEIVED',
            received_at: new Date(),
        });
        return { receipt, duplicate: false };
    } catch (err) {
        // A concurrent delivery of the same event lost the unique-index race.
        // That is a duplicate, not a persistence failure.
        if (err?.name === 'SequelizeUniqueConstraintError') {
            const existing = await MetaWebhookReceipt.findOne({ where: { dedupe_key: dedupeKey } })
                .catch(() => null);
            if (existing) return { receipt: existing, duplicate: true };
        }
        logger.error('Durable webhook receipt write failed — returning retryable error to Meta', {
            pageId: String(pageId),
            eventType,
            errorCode: err?.name || 'UnknownError',
        });
        throw new WebhookReceiptPersistenceError(err);
    }
}

async function safeUpdate(receipt, fields) {
    if (!receipt || typeof receipt.update !== 'function') return;
    try {
        await receipt.update(fields);
    } catch (err) {
        logger.error('Failed to update webhook receipt status', {
            receiptId: receipt.id,
            errorCode: err?.name || 'UnknownError',
        });
    }
}

/** Event carries no business action (echo, delivery, read, unrecognised). */
async function markSkipped(receipt, reasonCode) {
    await safeUpdate(receipt, {
        status: 'SKIPPED',
        last_error_code: reasonCode || null,
        payload_encrypted: null,
        processed_at: new Date(),
        next_retry_at: null,
    });
}

async function markProcessing(receipt) {
    await safeUpdate(receipt, { status: 'PROCESSING' });
}

async function markProcessed(receipt, { shopId = null, metaChannelId = null } = {}) {
    await safeUpdate(receipt, {
        status: 'PROCESSED',
        shop_id: shopId,
        meta_channel_id: metaChannelId,
        payload_encrypted: null,
        last_error_code: null,
        next_retry_at: null,
        processed_at: new Date(),
    });
}

function nextRetryAt(ladder, retryCount) {
    const minutes = ladder[Math.min(retryCount, ladder.length - 1)];
    return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * The Page is unknown, or its channel is not CONNECTED. The event stays
 * retryable: a legitimate reconnect makes it deliverable without data loss.
 *
 * @param {boolean} [opts.incrementRetry] true when called from the reconciler,
 *   so the backoff ladder actually advances instead of resetting each cycle.
 */
async function markIdentityNotResolved(receipt, { pageId, alert = true, incrementRetry = false } = {}) {
    if (!receipt) return;
    const retryCount = (receipt.retry_count || 0) + (incrementRetry ? 1 : 0);

    if (retryCount >= MAX_IDENTITY_RETRIES) {
        await deadLetter(receipt, 'PAGE_NOT_CONNECTED_EXHAUSTED');
        return;
    }

    await safeUpdate(receipt, {
        status: 'IDENTITY_NOT_RESOLVED',
        retry_count: retryCount,
        last_error_code: 'PAGE_NOT_CONNECTED',
        processing_token: null,
        next_retry_at: nextRetryAt(IDENTITY_RETRY_BACKOFF_MINUTES, retryCount),
    });

    if (alert) {
        // PII-free: page id and counts only, never the sender or message body.
        opsAlert('Meta webhook — Page not connected, inbound message held', {
            detail: `page_id=${pageId || receipt.page_id} receipt=${receipt.id} `
                + `retry=${retryCount}/${MAX_IDENTITY_RETRIES}. The event is durably held and will be `
                + 'retried; reconnect the channel to deliver it.',
            level: 'error',
            context: { pageId: String(pageId || receipt.page_id), receiptId: receipt.id, retryCount },
        }).catch(() => {});
    }
}

/**
 * Message storage failed. Bounded backoff, then dead-letter.
 */
async function markStoreFailure(receipt, err, { pageId } = {}) {
    if (!receipt) return;
    const retryCount = (receipt.retry_count || 0) + 1;
    const errorCode = String(err?.name || 'UnknownError').slice(0, 64);

    if (retryCount > MAX_STORE_RETRIES) {
        await deadLetter(receipt, errorCode);
        return;
    }

    await safeUpdate(receipt, {
        status: 'RETRY_PENDING',
        retry_count: retryCount,
        last_error_code: errorCode,
        processing_token: null,
        next_retry_at: nextRetryAt(STORE_RETRY_BACKOFF_MINUTES, retryCount),
    });

    opsAlert('Meta webhook — inbound message store failed, retry scheduled', {
        detail: `page_id=${pageId || receipt.page_id} receipt=${receipt.id} `
            + `attempt=${retryCount}/${MAX_STORE_RETRIES} code=${errorCode}`,
        level: 'error',
        context: { pageId: String(pageId || receipt.page_id), receiptId: receipt.id, retryCount, errorCode },
    }).catch(() => {});
}

/** Terminal failure sink — queryable DLQ surfaced by /health/detailed. */
async function deadLetter(receipt, errorCode) {
    await safeUpdate(receipt, {
        status: 'DEAD_LETTERED',
        last_error_code: String(errorCode || 'UNKNOWN').slice(0, 64),
        next_retry_at: null,
        processed_at: new Date(),
    });

    opsAlert('Meta webhook — inbound message DEAD-LETTERED', {
        detail: `page_id=${receipt.page_id} receipt=${receipt.id} code=${errorCode}. `
            + 'A real customer message was never ingested. Manual replay required.',
        level: 'error',
        context: { pageId: receipt.page_id, receiptId: receipt.id, errorCode: String(errorCode || '') },
    }).catch(() => {});
}

/**
 * Claim receipts whose retry is due, fencing each with a processing token so two
 * reconciler runs can never replay the same event concurrently.
 *
 * @returns {Promise<Array<{receipt: object, payload: object|null}>>}
 */
async function claimDueReceipts(limit = 25) {
    const { Op } = require('sequelize');
    const now = new Date();
    const due = await MetaWebhookReceipt.findAll({
        where: {
            [Op.or]: [
                {
                    status: { [Op.in]: RETRYABLE_STATUSES },
                    next_retry_at: { [Op.lte]: now },
                },
                // Reclaim a claim abandoned by a crashed runner.
                {
                    status: 'PROCESSING',
                    updated_at: { [Op.lt]: new Date(now.getTime() - STALE_CLAIM_MS) },
                },
            ],
        },
        order: [['next_retry_at', 'ASC']],
        limit,
    });

    const claimed = [];
    for (const receipt of due) {
        const token = crypto.randomBytes(16).toString('hex');
        const [updatedCount] = await MetaWebhookReceipt.update(
            { status: 'PROCESSING', processing_token: token },
            { where: { id: receipt.id, status: receipt.status, processing_token: receipt.processing_token } },
        );
        if (updatedCount !== 1) continue; // lost the race to another runner

        let payload = null;
        if (receipt.payload_encrypted) {
            try {
                payload = decryptPayload(receipt.payload_encrypted);
            } catch (_) {
                await deadLetter(receipt, 'PAYLOAD_UNREADABLE');
                continue;
            }
        }
        if (!payload) {
            await deadLetter(receipt, 'PAYLOAD_MISSING');
            continue;
        }

        receipt.set({ status: 'PROCESSING', processing_token: token });
        claimed.push({ receipt, payload });
    }
    return claimed;
}

/** Count of events that were never ingested. Non-zero = customers lost messages. */
async function countDeadLettered() {
    return MetaWebhookReceipt.count({ where: { status: 'DEAD_LETTERED' } });
}

/** Count of events held because their Page is not connected. */
async function countUnresolved() {
    const { Op } = require('sequelize');
    return MetaWebhookReceipt.count({
        where: { status: { [Op.in]: ['IDENTITY_NOT_RESOLVED', 'RETRY_PENDING', 'MESSAGE_STORE_FAILED'] } },
    });
}

/** Retention sweep — receipts are evidence with an expiry, not an archive. */
async function purgeExpiredReceipts(now = new Date()) {
    const { Op } = require('sequelize');
    const terminalCutoff = new Date(now.getTime() - TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deadCutoff = new Date(now.getTime() - DEAD_LETTER_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const removed = await MetaWebhookReceipt.destroy({
        where: {
            [Op.or]: [
                { status: { [Op.in]: ['PROCESSED', 'SKIPPED'] }, created_at: { [Op.lt]: terminalCutoff } },
                { status: 'DEAD_LETTERED', created_at: { [Op.lt]: deadCutoff } },
            ],
        },
    });
    return removed;
}

module.exports = {
    WebhookReceiptPersistenceError,
    classifyEvent,
    recordReceipt,
    markSkipped,
    markProcessing,
    markProcessed,
    markIdentityNotResolved,
    markStoreFailure,
    deadLetter,
    claimDueReceipts,
    countDeadLettered,
    countUnresolved,
    purgeExpiredReceipts,
    MAX_STORE_RETRIES,
    MAX_IDENTITY_RETRIES,
    STORE_RETRY_BACKOFF_MINUTES,
    IDENTITY_RETRY_BACKOFF_MINUTES,
    TERMINAL_STATUSES,
    RETRYABLE_STATUSES,
};
