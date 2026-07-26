'use strict';

/**
 * Meta webhook receipt reconciler (F-02 / F-03).
 *
 * Replays inbound events that were durably held rather than ingested:
 *   - IDENTITY_NOT_RESOLVED — the Page was unknown or not CONNECTED at delivery
 *   - RETRY_PENDING / MESSAGE_STORE_FAILED — the message INSERT failed
 *
 * Each due receipt is claimed with a fencing token, replayed through the SAME
 * ingestion path the live webhook uses, and settled: PROCESSED on success, back
 * to a longer backoff on a repeat failure, DEAD_LETTERED once the ladder is
 * exhausted. Exhaustion always alerts — a dead-lettered receipt means a real
 * customer message was never ingested.
 *
 * Also runs the retention sweep so receipts stay operational evidence with an
 * expiry rather than an archive of customer message bodies.
 */

const receiptService = require('../modules/integration/meta-webhook-receipt.service');
const { resolveConnectedChannel } = require('../modules/integration/meta-channel-resolver');
const { processMessagingEvent } = require('../modules/integration/meta-webhook-events.handler');
const { createLogger } = require('../utils/structured-logger');

const logger = createLogger('WebhookReceiptReconciler');

const num = (envVal, fallback) => {
    const n = parseInt(envVal, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const BATCH_SIZE = num(process.env.WEBHOOK_RECONCILE_BATCH, 25);

class WebhookReceiptReconcilerJob {
    /**
     * @param {object} [opts]
     * @param {boolean} [opts.dryRun] report what is due without replaying it
     */
    async execute({ dryRun = false } = {}) {
        const results = { claimed: 0, processed: 0, skipped: 0, failed: 0, unresolved: 0, purged: 0, dryRun };

        if (dryRun) {
            results.unresolved = await receiptService.countUnresolved();
            results.deadLettered = await receiptService.countDeadLettered();
            return results;
        }

        let claimed = [];
        try {
            claimed = await receiptService.claimDueReceipts(BATCH_SIZE);
        } catch (err) {
            logger.error('Failed to claim due webhook receipts', { errorCode: err?.name || 'UnknownError' });
            return results;
        }
        results.claimed = claimed.length;

        for (const { receipt, payload } of claimed) {
            const pageId = receipt.page_id;
            let channel = null;
            try {
                channel = await resolveConnectedChannel(pageId, 'facebook');
            } catch (err) {
                logger.error('Channel resolution failed during reconcile', {
                    receiptId: receipt.id, errorCode: err?.name || 'UnknownError',
                });
            }

            if (!channel) {
                // Still not connected — advance the ladder, stay quiet after the
                // first alert so a long-unreconnected Page does not page hourly.
                await receiptService.markIdentityNotResolved(receipt, {
                    pageId,
                    alert: false,
                    incrementRetry: true,
                });
                results.unresolved += 1;
                continue;
            }

            const outcome = await processMessagingEvent({
                messaging: payload,
                channel,
                receipt,
                pageId,
            });
            if (outcome === 'processed') results.processed += 1;
            else if (outcome === 'skipped') results.skipped += 1;
            else results.failed += 1;
        }

        try {
            results.purged = await receiptService.purgeExpiredReceipts();
        } catch (err) {
            logger.warn('Webhook receipt retention sweep failed', { errorCode: err?.name || 'UnknownError' });
        }

        if (results.claimed > 0) {
            logger.info('Webhook receipt reconcile complete', results);
        }
        return results;
    }
}

module.exports = WebhookReceiptReconcilerJob;
