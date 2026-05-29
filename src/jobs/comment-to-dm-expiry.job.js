'use strict';

/**
 * comment-to-dm-expiry.job.js
 *
 * Cron job: mark stale Comment-to-DM rows as EXPIRED.
 * Runs daily at 03:00 UTC (registered in queue-manager.js).
 *
 * Qualifying rows:
 *   state IN (DM_INVITE_SENT, CUSTOMER_OPENED_DM)
 *   AND last_transition_at < NOW() - 7 days
 *
 * Delegates entirely to CommentToDmService.expireStale() which handles
 * the DB update and SSE notification per row.
 *
 * Extends BaseJob for distributed Redis lock + AuditLog idempotency.
 */

const BaseJob = require('./base-job');
const { createLogger } = require('../utils/structured-logger');

const logger = createLogger('CommentToDmExpiryJob');

class CommentToDmExpiryJob extends BaseJob {

    constructor() {
        super('comment_to_dm_expiry');
    }

    /**
     * @param {{ dryRun: boolean, runDate: Date }} options
     */
    async run({ dryRun }) {
        logger.info(`[${this.jobName}] Starting expiry sweep`, { dryRun });

        if (dryRun) {
            logger.info(`[${this.jobName}] Dry-run — skipping DB updates`);
            return { dryRun: true, expired: 0 };
        }

        const CommentToDmService = require('../modules/commentToDm/comment-to-dm.service');
        const service = new CommentToDmService();

        const result = await service.expireStale();

        this.metrics.recordsProcessed = result.checked;
        this.metrics.recordsSucceeded = result.expired;

        logger.info(`[${this.jobName}] Expiry sweep complete`, result);
        return result;
    }
}

module.exports = CommentToDmExpiryJob;
