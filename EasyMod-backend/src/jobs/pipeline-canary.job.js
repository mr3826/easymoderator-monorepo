'use strict';

/**
 * Auto-reply pipeline canary.
 *
 * Runs every few minutes (scheduled in queue-manager). Its job is to make the
 * silent-failure class IMPOSSIBLE to ship unnoticed — the exact class that took
 * down auto-send for every shop when a `:` in a BullMQ jobId made queue.add throw
 * and no reply was ever produced.
 *
 * Each run does three things, in this order (the order makes it race-free):
 *   1. CHECK the heartbeat written by the PREVIOUS cycle's probe. If the worker
 *      processed it, `canary:msg:last_ok` is fresh. If it's stale (or the very
 *      enqueue below has been failing), the worker is down/wedged → alert.
 *   2. CHECK depth of the dead-letter queue and the live backlog. A non-empty
 *      message-dlq means real customers got NO reply → alert.
 *   3. ENQUEUE a fresh probe onto message-processing for the NEXT cycle. If the
 *      enqueue itself throws, that IS the jobId-bug failure mode → alert loudly.
 *
 * The probe is short-circuited at the very top of processMessageJob (it sets the
 * heartbeat and returns before any DB/AI/Meta-send work), so it costs nothing and
 * never messages a real customer.
 */

const { Queue } = require('bullmq');
const { messageQueue, connection } = require('./message-queue');
const { cacheRedis } = require('../config/redis');
const { opsAlert } = require('../utils/ops-alert');

const HEARTBEAT_KEY = 'canary:msg:last_ok';

const num = (envVal, fallback) => {
    const n = parseInt(envVal, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// A probe should complete within seconds; 15 min of silence means the worker is
// not consuming the queue. DLQ alerts on the first dead-lettered message.
const MAX_STALENESS_MS = num(process.env.CANARY_MAX_STALENESS_MS, 15 * 60 * 1000);
const DLQ_ALERT_THRESHOLD = num(process.env.CANARY_DLQ_THRESHOLD, 1);
const BACKLOG_ALERT_THRESHOLD = num(process.env.CANARY_BACKLOG_THRESHOLD, 200);

class PipelineCanaryJob {
    /**
     * @param {object} [_opts] dryRun/runDate from the generic worker — unused.
     */
    async execute(_opts = {}) {
        const now = Date.now();
        const results = { checkedAt: new Date(now).toISOString() };

        // ── 1. Staleness: did the previous probe complete? ──────────────────
        let lastOk = null;
        try { lastOk = await cacheRedis.get(HEARTBEAT_KEY); } catch (_) { /* read best-effort */ }

        if (lastOk) {
            const ageMs = now - parseInt(lastOk, 10);
            results.heartbeatAgeMs = ageMs;
            if (ageMs > MAX_STALENESS_MS) {
                await opsAlert('Auto-reply pipeline STALE — worker not completing canary probes', {
                    detail: `Last canary completion ${Math.round(ageMs / 1000)}s ago `
                        + `(threshold ${Math.round(MAX_STALENESS_MS / 1000)}s). `
                        + `The message-processing worker is likely down or wedged — replies are NOT being sent.`,
                    level: 'error',
                    context: results,
                });
            }
        } else {
            // No heartbeat yet — first run(s) after boot. Don't alert on staleness;
            // the enqueue below will produce one for the next cycle to check.
            results.heartbeatAgeMs = null;
        }

        // ── 2. Depth: dead-letter queue + live backlog ──────────────────────
        const dlq = new Queue('message-dlq', { connection });
        try {
            const [dlqWaiting, backlog, failed, active, delayed] = await Promise.all([
                dlq.getWaitingCount(),
                messageQueue.getWaitingCount(),
                messageQueue.getFailedCount(),
                messageQueue.getActiveCount(),
                messageQueue.getDelayedCount(),
            ]);
            Object.assign(results, { dlq: dlqWaiting, backlog, failed, active, delayed });

            if (dlqWaiting >= DLQ_ALERT_THRESHOLD) {
                await opsAlert('Auto-reply DLQ is NOT empty — messages failed every retry', {
                    detail: `message-dlq depth = ${dlqWaiting}. Those customers received NO reply. `
                        + `Inspect the dead-lettered jobs and reprocess once the root cause is fixed.`,
                    level: 'error',
                    context: results,
                });
            }
            if (backlog >= BACKLOG_ALERT_THRESHOLD) {
                await opsAlert('Auto-reply backlog is high', {
                    detail: `message-processing waiting = ${backlog} (threshold ${BACKLOG_ALERT_THRESHOLD}). `
                        + `Replies are being delayed — check worker throughput / Meta rate limits.`,
                    level: 'warning',
                    context: results,
                });
            }
        } finally {
            await dlq.close().catch(() => {});
        }

        // ── 3. Enqueue the next probe (jobId uses '_' — ':' is forbidden) ────
        try {
            await messageQueue.add('canary', { canary: true, enqueuedAt: now }, {
                jobId: `canary_${now}`,
                attempts: 1,
                removeOnComplete: true,
                removeOnFail: true,
            });
            results.probeEnqueued = true;
        } catch (err) {
            results.probeEnqueued = false;
            await opsAlert('Auto-reply canary FAILED TO ENQUEUE its probe', {
                detail: `queue.add threw: ${err.message}. This is the exact silent-failure class `
                    + `(a job that never enqueues → no reply is ever produced).`,
                level: 'error',
                context: { error: err.message },
            });
        }

        return results;
    }
}

module.exports = PipelineCanaryJob;
