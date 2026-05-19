'use strict';

/**
 * comment-to-dm.worker.js
 *
 * BullMQ worker for the `comment-to-dm` queue.
 *
 * Dequeues `processQueuedComment` jobs and delegates to CommentToDmService.
 * Each job carries { eventId } identifying the comment_to_dm_events row.
 *
 * Follows the same shape as other workers in the codebase:
 *   - Constructed by QueueManager
 *   - execute() is the worker processor function called by BullMQ
 *   - All errors are propagated back to BullMQ for retry/DLQ handling
 *
 * Idempotency: the service uses Redis NX key — BullMQ retry is safe.
 */

const { createLogger } = require('../utils/structured-logger');

const logger = createLogger('CommentToDmWorker');

class CommentToDmWorker {

    /**
     * BullMQ processor — called for each dequeued job.
     * Instantiates the service fresh per job to avoid state leak across jobs.
     *
     * @param {import('bullmq').Job} job
     */
    async execute(job) {
        const { eventId } = job.data;

        if (!eventId) {
            logger.warn('CommentToDmWorker: job missing eventId', { jobId: job.id });
            return { skipped: true, reason: 'missing_event_id' };
        }

        logger.info('CommentToDmWorker: processing job', { jobId: job.id, eventId });

        // Lazy-require to avoid circular deps at module load time
        const CommentToDmService = require('../modules/commentToDm/comment-to-dm.service');
        const service = new CommentToDmService();

        await service.processQueuedComment({ eventId });

        logger.info('CommentToDmWorker: job completed', { jobId: job.id, eventId });
        return { eventId };
    }
}

module.exports = CommentToDmWorker;
