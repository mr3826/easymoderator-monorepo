/**
 * drainChannelJobs — unit tests
 *
 * Verifies that drainChannelJobs removes only the jobs whose payload matches
 * the disconnected channel, and leaves unrelated jobs untouched.
 *
 * BullMQ's Queue is fully mocked — no Redis connection required.
 */
'use strict';

process.env.NODE_ENV = 'test';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Mock the bullmq Queue constructor before any require of message-queue.js
const mockGetJobs = jest.fn();
jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        getJobs: mockGetJobs,
    })),
}));

// Silence logger calls from adjacent modules
jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    })),
}));

jest.mock('src/config/config', () => ({
    redisUrl: null,
    redisHost: 'localhost',
    redisPort: '6379',
    redisPassword: null,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(id, data) {
    return {
        id,
        data,
        remove: jest.fn().mockResolvedValue(undefined),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('drainChannelJobs', () => {
    let drainChannelJobs;

    beforeEach(() => {
        jest.resetModules();
        mockGetJobs.mockReset();

        // Re-require after reset so the Queue mock is cleanly rebound
        ({ drainChannelJobs } = require('src/jobs/message-queue'));
    });

    it('removes jobs matching metaChannelId (primary key path)', async () => {
        const targetJob = makeJob('j1', { metaChannelId: 'ch-abc', shopId: 'shop-1', platform: 'facebook' });
        const otherJob  = makeJob('j2', { metaChannelId: 'ch-xyz', shopId: 'shop-1', platform: 'facebook' });
        mockGetJobs.mockResolvedValue([targetJob, otherJob]);

        const result = await drainChannelJobs({ metaChannelId: 'ch-abc', shopId: 'shop-1', platform: 'facebook' });

        expect(targetJob.remove).toHaveBeenCalledTimes(1);
        expect(otherJob.remove).not.toHaveBeenCalled();
        expect(result.removed).toBe(1);
    });

    it('removes legacy jobs matching shopId + platform fallback when metaChannelId absent', async () => {
        const legacyJob = makeJob('j3', { shopId: 'shop-2', platform: 'facebook' }); // no metaChannelId
        const freshJob  = makeJob('j4', { metaChannelId: 'ch-def', shopId: 'shop-2', platform: 'facebook' });
        const otherJob  = makeJob('j5', { shopId: 'shop-2', platform: 'instagram' });
        mockGetJobs.mockResolvedValue([legacyJob, freshJob, otherJob]);

        // Simulate a legacy shop that has no metaChannelId in job payload:
        // drainChannelJobs called with metaChannelId null falls back to shopId+platform.
        const result = await drainChannelJobs({ metaChannelId: null, shopId: 'shop-2', platform: 'facebook' });

        expect(legacyJob.remove).toHaveBeenCalledTimes(1);
        expect(freshJob.remove).not.toHaveBeenCalled();  // 'ch-def' !== null so matchesPk is false; matchesLegacy requires !matchesPk
        expect(otherJob.remove).not.toHaveBeenCalled();  // wrong platform
        expect(result.removed).toBe(1);
    });

    it('normalises messenger → facebook in legacy fallback', async () => {
        const messengerJob = makeJob('j6', { shopId: 'shop-3', platform: 'messenger' });
        mockGetJobs.mockResolvedValue([messengerJob]);

        const result = await drainChannelJobs({ metaChannelId: null, shopId: 'shop-3', platform: 'facebook' });

        expect(messengerJob.remove).toHaveBeenCalledTimes(1);
        expect(result.removed).toBe(1);
    });

    it('returns { removed: 0 } when no jobs match', async () => {
        mockGetJobs.mockResolvedValue([
            makeJob('j7', { metaChannelId: 'ch-zzz', shopId: 'shop-9', platform: 'facebook' }),
        ]);

        const result = await drainChannelJobs({ metaChannelId: 'ch-nope', shopId: 'shop-9', platform: 'facebook' });

        expect(result.removed).toBe(0);
    });

    it('is non-fatal when getJobs throws (Redis down scenario)', async () => {
        mockGetJobs.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await drainChannelJobs({ metaChannelId: 'ch-abc', shopId: 'shop-1', platform: 'facebook' });

        expect(result.removed).toBe(0);
        // Should not throw — disconnect must remain non-fatal with respect to Redis failures
    });

    it('continues if individual job.remove() fails (job already active)', async () => {
        const job1 = makeJob('j8', { metaChannelId: 'ch-abc' });
        const job2 = makeJob('j9', { metaChannelId: 'ch-abc' });
        job1.remove.mockRejectedValue(new Error('Job is locked'));
        mockGetJobs.mockResolvedValue([job1, job2]);

        const result = await drainChannelJobs({ metaChannelId: 'ch-abc', shopId: 'shop-1', platform: 'facebook' });

        // job2 still removed even though job1 threw
        expect(job2.remove).toHaveBeenCalledTimes(1);
        expect(result.removed).toBe(1);
    });
});
