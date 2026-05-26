'use strict';

const { Queue } = require('bullmq');
const config = require('../config/config');

function buildConnection() {
    const base = {
        db: 3, // Dedicated DB — separate from Bull queues (DB 0) and app cache (DB 1)
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: false,   // Required by BullMQ
    };

    if (config.redisUrl) {
        try {
            const parsed = new URL(config.redisUrl);
            const conn = {
                ...base,
                host: parsed.hostname,
                port: parseInt(parsed.port) || 6379,
            };
            if (parsed.password) conn.password = decodeURIComponent(parsed.password);
            if (parsed.protocol === 'rediss:') conn.tls = { rejectUnauthorized: false };
            return conn;
        } catch (_) { /* fall through */ }
    }

    return {
        ...base,
        host: config.redisHost || 'localhost',
        port: parseInt(config.redisPort) || 6379,
        ...(config.redisPassword ? { password: config.redisPassword } : {}),
    };
}

const connection = buildConnection();

const messageQueue = new Queue('message-processing', {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }, // 2s → 4s → 8s
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 }, // DLQ: retain last 500 failed jobs
    },
});

messageQueue.on('error', (err) => {
    console.error('[messageQueue] Queue error:', err.message);
});

/**
 * Drain all pending (waiting + delayed) message-processing jobs that belong to
 * a specific channel. Called when a channel is disconnected so queued jobs
 * don't keep retrying with a now-cleared token.
 *
 * Match strategy: primary key `metaChannelId` in job data (set by the webhook
 * dispatcher for all jobs since Phase 1). Legacy jobs that pre-date the FK
 * threading carry only `shopId + platform`; those are matched via the
 * `shopId + platform` fallback pair so they are also cleaned up.
 *
 * @param {object} params
 * @param {string} params.metaChannelId  - UUID primary key of the MetaChannel row
 * @param {string} params.shopId         - Multi-tenant guard / fallback matcher
 * @param {'facebook'|'instagram'} params.platform - Fallback matcher for legacy jobs
 * @returns {Promise<{ removed: number }>}
 */
async function drainChannelJobs({ metaChannelId, shopId, platform }) {
    try {
        const states = ['waiting', 'delayed', 'prioritized'];
        const jobs = await messageQueue.getJobs(states, 0, -1);
        let removed = 0;
        await Promise.all(
            jobs.map(async (job) => {
                const d = job.data || {};
                // Primary match: job payload carries the channel's primary key UUID.
                const matchesPk =
                    metaChannelId && d.metaChannelId === metaChannelId;
                // Legacy fallback: pre-Phase-1 jobs have no metaChannelId in their
                // payload. Match only when the job itself has no metaChannelId AND
                // the shopId+platform pair matches.  Jobs that DO carry a different
                // metaChannelId belong to a different channel and must be left alone.
                const jobHasChannelId = Boolean(d.metaChannelId);
                const matchesLegacy =
                    !matchesPk && !jobHasChannelId &&
                    shopId && platform &&
                    d.shopId === shopId &&
                    (d.platform === platform || (platform === 'facebook' && d.platform === 'messenger'));
                if (matchesPk || matchesLegacy) {
                    try {
                        await job.remove();
                        removed++;
                    } catch (removeErr) {
                        // Job may have moved to active between the list and remove — ignore.
                        console.warn(`[messageQueue] drainChannelJobs: could not remove job ${job.id}: ${removeErr.message}`);
                    }
                }
            }),
        );
        if (removed > 0) {
            console.log(`[messageQueue] drainChannelJobs: removed ${removed} pending job(s) for channel ${metaChannelId}`);
        }
        return { removed };
    } catch (err) {
        // Non-fatal: if Redis is down during a disconnect we don't want to block the disconnect itself.
        console.error(`[messageQueue] drainChannelJobs failed (non-fatal): ${err.message}`);
        return { removed: 0 };
    }
}

module.exports = { messageQueue, connection, drainChannelJobs };
