'use strict';

/**
 * Failed Jobs (DLQ) Admin API
 *
 * Exposes the BullMQ message-processing failed-job list so operators can inspect
 * messages that exhausted all retry attempts without silently disappearing.
 *
 * All endpoints require authentication AND an EasyModerator platform-admin role
 * (SUPPORT_ADMIN or SUPER_ADMIN), via requirePlatformAdmin.
 *
 * Endpoints:
 *   GET  /api/admin/failed-jobs          — list failed jobs (paginated)
 *   POST /api/admin/failed-jobs/:id/retry — requeue a single failed job
 *   DELETE /api/admin/failed-jobs/:id    — discard a single failed job
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { requirePlatformAdmin } = require('../../middleware/platform-admin.middleware');

const router = express.Router();

router.use(authenticate, requirePlatformAdmin());

function getQueue() {
    try {
        return require('../../jobs/message-queue').messageQueue;
    } catch (err) {
        return null;
    }
}

/**
 * GET /api/admin/failed-jobs
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/', async (req, res) => {
    const queue = getQueue();
    if (!queue) {
        return res.status(503).json({ success: false, error: 'Message queue not available' });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;

        const [failedJobs, totalFailed] = await Promise.all([
            queue.getFailed(offset, offset + limit - 1),
            queue.getFailedCount(),
        ]);

        res.json({
            success: true,
            data: {
                total: totalFailed,
                limit,
                offset,
                jobs: failedJobs.map(j => ({
                    id: j.id,
                    shopId: j.data?.shopId,
                    conversationId: j.data?.conversationId,
                    externalId: j.data?.externalId,
                    message: j.data?.message ? j.data.message.slice(0, 100) : null,
                    platform: j.data?.platform,
                    failedReason: j.failedReason,
                    attemptsMade: j.attemptsMade,
                    failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
                    stackTrace: j.stacktrace?.[0] || null,
                })),
            },
        });
    } catch (err) {
        console.error('[failed-jobs] GET error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/failed-jobs/:id/retry
 * Moves the failed job back to the waiting queue for one more attempt.
 */
router.post('/:id/retry', async (req, res) => {
    const queue = getQueue();
    if (!queue) return res.status(503).json({ success: false, error: 'Message queue not available' });

    try {
        const failedJobs = await queue.getFailed();
        const job = failedJobs.find(j => j.id === req.params.id);
        if (!job) return res.status(404).json({ success: false, error: 'Job not found in failed queue' });

        await job.retry();
        res.json({ success: true, message: `Job ${req.params.id} re-queued` });
    } catch (err) {
        console.error('[failed-jobs] retry error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/admin/failed-jobs/:id
 * Permanently removes a failed job from the DLQ.
 */
router.delete('/:id', async (req, res) => {
    const queue = getQueue();
    if (!queue) return res.status(503).json({ success: false, error: 'Message queue not available' });

    try {
        const failedJobs = await queue.getFailed();
        const job = failedJobs.find(j => j.id === req.params.id);
        if (!job) return res.status(404).json({ success: false, error: 'Job not found in failed queue' });

        await job.remove();
        res.json({ success: true, message: `Job ${req.params.id} removed from DLQ` });
    } catch (err) {
        console.error('[failed-jobs] delete error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
