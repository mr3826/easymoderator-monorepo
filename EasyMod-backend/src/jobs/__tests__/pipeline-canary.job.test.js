'use strict';

/**
 * Unit tests for the auto-reply pipeline canary / DLQ watchdog.
 * All external edges (BullMQ, Redis cache, ops alerting) are mocked so the test
 * exercises pure decision logic: when does it alert, and is a probe enqueued.
 *
 * Note on module resolution: pipeline-canary requires `./message-queue`, which
 * resolves to the REAL module (the jest stub only catches paths containing
 * `/jobs/`). So we mock `bullmq` with a full-featured Queue — the real
 * message-queue.js builds its `messageQueue` from it at load time, and that same
 * instance is what the canary reads. Counts are driven by `mockQueueState`.
 */

const mockQueueState = { dlqDepth: 0, mpWaiting: 0 };

jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation((name) => ({
        name,
        on: jest.fn(),
        add: jest.fn().mockResolvedValue({ id: 'job-1' }),
        close: jest.fn().mockResolvedValue(undefined),
        getWaitingCount: jest.fn().mockImplementation(() => Promise.resolve(
            name === 'message-dlq' ? mockQueueState.dlqDepth : mockQueueState.mpWaiting,
        )),
        getFailedCount: jest.fn().mockResolvedValue(0),
        getActiveCount: jest.fn().mockResolvedValue(0),
        getDelayedCount: jest.fn().mockResolvedValue(0),
    })),
}));

const mockRedisCache = {
    store: {},
    get: jest.fn((k) => Promise.resolve(mockRedisCache.store[k] ?? null)),
    set: jest.fn((k, v) => { mockRedisCache.store[k] = v; return Promise.resolve('OK'); }),
};
jest.mock('src/config/redis', () => ({ cacheRedis: mockRedisCache }));

const mockOpsAlert = jest.fn().mockResolvedValue(undefined);
jest.mock('src/utils/ops-alert', () => ({ opsAlert: mockOpsAlert }));

const HEARTBEAT_KEY = 'canary:msg:last_ok';

describe('PipelineCanaryJob', () => {
    let PipelineCanaryJob;
    let messageQueue;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisCache.store = {};
        mockQueueState.dlqDepth = 0;
        mockQueueState.mpWaiting = 0;

        // The real message-queue module, whose messageQueue was built from the
        // mocked bullmq Queue above. Reset add() to healthy default each test.
        ({ messageQueue } = require('src/jobs/message-queue'));
        messageQueue.add = jest.fn().mockResolvedValue({ id: 'job-1' });

        PipelineCanaryJob = require('src/jobs/pipeline-canary.job');
    });

    test('healthy pipeline: fresh heartbeat, empty DLQ → no alert, probe enqueued', async () => {
        mockRedisCache.store[HEARTBEAT_KEY] = String(Date.now() - 1000); // 1s ago

        const result = await new PipelineCanaryJob().execute();

        expect(mockOpsAlert).not.toHaveBeenCalled();
        expect(result.probeEnqueued).toBe(true);
        expect(messageQueue.add).toHaveBeenCalledTimes(1);
        const [name, data, opts] = messageQueue.add.mock.calls[0];
        expect(name).toBe('canary');
        expect(data.canary).toBe(true);
        expect(opts.jobId).toMatch(/^canary_\d+$/);  // '_' separator, never ':'
        expect(opts.jobId).not.toContain(':');
    });

    test('first run with no heartbeat: warming up → no staleness alert, probe enqueued', async () => {
        const result = await new PipelineCanaryJob().execute();

        expect(mockOpsAlert).not.toHaveBeenCalled();
        expect(result.heartbeatAgeMs).toBeNull();
        expect(result.probeEnqueued).toBe(true);
    });

    test('stale heartbeat → fires a STALE alert', async () => {
        mockRedisCache.store[HEARTBEAT_KEY] = String(Date.now() - 30 * 60 * 1000); // 30 min ago

        await new PipelineCanaryJob().execute();

        expect(mockOpsAlert).toHaveBeenCalledTimes(1);
        expect(mockOpsAlert.mock.calls[0][0]).toMatch(/STALE/i);
        expect(mockOpsAlert.mock.calls[0][1].level).toBe('error');
    });

    test('non-empty DLQ → fires a DLQ alert (error level)', async () => {
        mockRedisCache.store[HEARTBEAT_KEY] = String(Date.now() - 1000); // fresh, so only DLQ alerts
        mockQueueState.dlqDepth = 3;

        const result = await new PipelineCanaryJob().execute();

        expect(result.dlq).toBe(3);
        expect(mockOpsAlert).toHaveBeenCalledTimes(1);
        expect(mockOpsAlert.mock.calls[0][0]).toMatch(/DLQ/i);
        expect(mockOpsAlert.mock.calls[0][1].level).toBe('error');
    });

    test('high backlog → fires a warning-level backlog alert', async () => {
        mockRedisCache.store[HEARTBEAT_KEY] = String(Date.now() - 1000);
        mockQueueState.mpWaiting = 500; // over default threshold 200

        await new PipelineCanaryJob().execute();

        expect(mockOpsAlert).toHaveBeenCalledTimes(1);
        expect(mockOpsAlert.mock.calls[0][0]).toMatch(/backlog/i);
        expect(mockOpsAlert.mock.calls[0][1].level).toBe('warning');
    });

    test('enqueue throwing → fires the FAILED TO ENQUEUE alert (the jobId-bug class)', async () => {
        mockRedisCache.store[HEARTBEAT_KEY] = String(Date.now() - 1000);
        messageQueue.add = jest.fn().mockRejectedValue(new Error('Custom Id cannot contain :'));

        const result = await new PipelineCanaryJob().execute();

        expect(result.probeEnqueued).toBe(false);
        expect(mockOpsAlert).toHaveBeenCalledTimes(1);
        expect(mockOpsAlert.mock.calls[0][0]).toMatch(/FAILED TO ENQUEUE/i);
    });
});
