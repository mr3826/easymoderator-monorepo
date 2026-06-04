/**
 * burst-coalescer — unit tests
 *
 * Covers the message-burst debounce + coalescing logic that turns a rapid-fire
 * sequence of customer messages ("Orna ache?" / "lal color ashe?" / "Size hobe")
 * into a SINGLE AI turn + single reply.
 *
 * BullMQ Queue, Redis, and the Message model are fully mocked — no infra needed.
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.AI_BURST_WINDOW_MS = '8000';
process.env.AI_BURST_MAX_WAIT_MS = '20000';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockAdd = jest.fn().mockResolvedValue({ id: 'flush-x' });
const mockGetJob = jest.fn();
jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        add: mockAdd,
        getJob: mockGetJob,
    })),
}));

const mockStore = new Map();
const mockRedis = {
    get: jest.fn((k) => Promise.resolve(mockStore.has(k) ? mockStore.get(k) : null)),
    set: jest.fn((k, v) => { mockStore.set(k, String(v)); return Promise.resolve('OK'); }),
    del: jest.fn((...keys) => { keys.forEach((k) => mockStore.delete(k)); return Promise.resolve(keys.length); }),
};
jest.mock('src/config/redis', () => ({ cacheRedis: mockRedis }));

const mockFindAll = jest.fn();
jest.mock('src/modules/conversation/conversation.entity', () => ({
    Message: { findAll: mockFindAll },
}));

jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

jest.mock('src/config/config', () => ({
    redisUrl: null, redisHost: 'localhost', redisPort: '6379', redisPassword: null,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeDelayedJob(id) {
    return { id, getState: jest.fn().mockResolvedValue('delayed'), remove: jest.fn().mockResolvedValue(undefined) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('burst-coalescer', () => {
    let coalescer;

    beforeEach(() => {
        jest.resetModules();
        mockAdd.mockClear();
        mockGetJob.mockReset();
        mockFindAll.mockReset();
        mockRedis.get.mockClear();
        mockRedis.set.mockClear();
        mockRedis.del.mockClear();
        mockStore.clear();
        coalescer = require('src/jobs/burst-coalescer');
    });

    afterEach(() => { jest.useRealTimers(); });

    describe('buildCoalescedTurn', () => {
        it('joins customer text lines in order and tracks the last message id', () => {
            const turn = coalescer.buildCoalescedTurn([
                { id: 'm1', sender: 'customer', content: 'Orna ache?', metadata: {} },
                { id: 'm2', sender: 'customer', content: 'lal color ashe?', metadata: {} },
                { id: 'm3', sender: 'customer', content: 'Size hobe', metadata: {} },
            ]);
            expect(turn.combinedText).toBe('Orna ache?\nlal color ashe?\nSize hobe');
            expect(turn.messageIds).toEqual(['m1', 'm2', 'm3']);
            expect(turn.lastMessageId).toBe('m3');
            expect(turn.imageUrls).toEqual([]);
        });

        it('gathers image urls and drops the bare [Attachment] placeholder', () => {
            const turn = coalescer.buildCoalescedTurn([
                { id: 'a', sender: 'customer', content: '[Attachment]', metadata: { image_url: 'http://img/1.jpg', message_type: 'image' } },
                { id: 'b', sender: 'customer', content: 'eta ki dam?', metadata: {} },
            ]);
            expect(turn.combinedText).toBe('eta ki dam?');
            expect(turn.imageUrls).toEqual(['http://img/1.jpg']);
            expect(turn.lastMessageId).toBe('b');
        });

        it('returns an empty turn for no messages', () => {
            const turn = coalescer.buildCoalescedTurn([]);
            expect(turn.messages).toEqual([]);
            expect(turn.combinedText).toBe('');
            expect(turn.lastMessageId).toBeNull();
        });
    });

    describe('scheduleBurstFlush', () => {
        const payload = { conversationId: 'conv-1', shopId: 'shop-1', platform: 'facebook', recipientId: 'psid-9', metaChannelId: 'ch-1' };

        it('schedules a delayed burst-flush job for the full window on the first message', async () => {
            await coalescer.scheduleBurstFlush(payload);

            expect(mockAdd).toHaveBeenCalledTimes(1);
            const [name, jobData, opts] = mockAdd.mock.calls[0];
            expect(name).toBe('burst-flush');
            expect(jobData).toMatchObject({ burstFlush: true, conversationId: 'conv-1', shopId: 'shop-1' });
            expect(opts.delay).toBe(8000);
            expect(opts.group).toEqual({ id: 'shop-1' });
            expect(typeof opts.jobId).toBe('string');
            // pending job id recorded for later rescheduling
            expect(mockStore.get('burst:pending:conv-1')).toBe(opts.jobId);
        });

        it('cancels the previously-scheduled flush before scheduling a fresh one (debounce)', async () => {
            // First message schedules a flush
            await coalescer.scheduleBurstFlush(payload);
            const firstJobId = mockStore.get('burst:pending:conv-1');

            // Second message within the window must remove the first delayed job, then re-add
            const prev = makeDelayedJob(firstJobId);
            mockGetJob.mockResolvedValueOnce(prev);

            await coalescer.scheduleBurstFlush(payload);

            expect(prev.remove).toHaveBeenCalledTimes(1);
            expect(mockAdd).toHaveBeenCalledTimes(2);
            // pending id was replaced with the new flush job id
            expect(mockStore.get('burst:pending:conv-1')).not.toBe(firstJobId);
        });

        it('clamps the delay by the hard cap so a non-stop typer cannot postpone forever', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-06-04T00:00:00Z'));
            const base = Date.now();
            // Burst opened 19s ago; with a 20s cap only 1s of wait remains.
            mockStore.set('burst:firstseen:conv-1', String(base - 19000));

            await coalescer.scheduleBurstFlush(payload);

            const opts = mockAdd.mock.calls[0][2];
            expect(opts.delay).toBe(1000);
        });

        it('uses delay 0 once the hard cap is fully exhausted', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-06-04T00:00:00Z'));
            const base = Date.now();
            mockStore.set('burst:firstseen:conv-1', String(base - 25000)); // past the 20s cap

            await coalescer.scheduleBurstFlush(payload);

            expect(mockAdd.mock.calls[0][2].delay).toBe(0);
        });
    });

    describe('cancelBurstFlush', () => {
        it('removes the pending flush job and clears the debounce keys', async () => {
            mockStore.set('burst:pending:conv-1', 'flush-7');
            mockStore.set('burst:firstseen:conv-1', '123');
            const prev = makeDelayedJob('flush-7');
            mockGetJob.mockResolvedValueOnce(prev);

            await coalescer.cancelBurstFlush('conv-1');

            expect(prev.remove).toHaveBeenCalledTimes(1);
            expect(mockStore.has('burst:pending:conv-1')).toBe(false);
            expect(mockStore.has('burst:firstseen:conv-1')).toBe(false);
        });

        it('is a no-op when nothing is pending', async () => {
            await expect(coalescer.cancelBurstFlush('conv-none')).resolves.toBeUndefined();
        });
    });

    describe('loadPendingCustomerTurn', () => {
        it('coalesces only the trailing unanswered customer messages (stops at the last reply)', async () => {
            // Message.findAll returns newest-first
            mockFindAll.mockResolvedValue([
                { id: 'm5', sender: 'customer', content: 'Size hobe', metadata: {} },
                { id: 'm4', sender: 'customer', content: 'lal color ashe?', metadata: {} },
                { id: 'm3', sender: 'customer', content: 'Orna ache?', metadata: {} },
                { id: 'm2', sender: 'ai', content: 'আগের রিপ্লাই', metadata: {} },     // boundary: previous AI reply
                { id: 'm1', sender: 'customer', content: 'purano kotha', metadata: {} },
            ]);

            const turn = await coalescer.loadPendingCustomerTurn('conv-1');

            expect(turn.messageIds).toEqual(['m3', 'm4', 'm5']);
            expect(turn.combinedText).toBe('Orna ache?\nlal color ashe?\nSize hobe');
            expect(turn.lastMessageId).toBe('m5');
        });

        it('returns an empty turn when the latest message is already an AI/business reply', async () => {
            mockFindAll.mockResolvedValue([
                { id: 'm2', sender: 'ai', content: 'reply', metadata: {} },
                { id: 'm1', sender: 'customer', content: 'q', metadata: {} },
            ]);

            const turn = await coalescer.loadPendingCustomerTurn('conv-1');

            expect(turn.messages).toEqual([]);
            expect(turn.lastMessageId).toBeNull();
        });
    });
});
