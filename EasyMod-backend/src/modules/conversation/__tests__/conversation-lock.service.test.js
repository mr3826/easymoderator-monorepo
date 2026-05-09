'use strict';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Mock: Redis cacheRedis client
// ---------------------------------------------------------------------------
const mockRedisSet = jest.fn();
const mockRedisPttl = jest.fn();
const mockRedisEval = jest.fn();
const mockRedisExists = jest.fn();

const mockRedis = {
    set: mockRedisSet,
    pttl: mockRedisPttl,
    eval: mockRedisEval,
    exists: mockRedisExists
};

// The lock service imports `cacheRedis` from '../../config/redis'
jest.mock('../../../config/redis', () => ({
    cacheRedis: {
        set: (...args) => mockRedisSet(...args),
        pttl: (...args) => mockRedisPttl(...args),
        eval: (...args) => mockRedisEval(...args),
        exists: (...args) => mockRedisExists(...args)
    },
    sessionRedis: {},
    rateLimitRedis: {},
    legacyRedis: {},
    closeAllRedis: jest.fn(),
    checkRedisAvailability: jest.fn()
}));

// ---------------------------------------------------------------------------
// Mock: structured-logger
// ---------------------------------------------------------------------------
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }))
}));

// ---------------------------------------------------------------------------
// Module under test — required AFTER all mocks
// ---------------------------------------------------------------------------
const lockService = require('../conversation-lock.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CONV_ID = 'conv-lock-test';
const LOCK_KEY = `lock:conversation:${CONV_ID}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ConversationLockService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // =========================================================================
    // acquireLock
    // =========================================================================
    describe('acquireLock', () => {
        it('should return success=true and a lockId when lock is acquired', async () => {
            mockRedisSet.mockResolvedValue('OK');

            const result = await lockService.acquireLock(CONV_ID);

            expect(result.success).toBe(true);
            expect(result.lockId).toMatch(/^lock_\d+_[a-f0-9]+$/);
            expect(result.conversationId).toBe(CONV_ID);
            expect(result.acquiredAt).toBeGreaterThan(0);
            expect(result.expiresAt).toBeGreaterThan(result.acquiredAt);
        });

        it('should call Redis SET with NX and PX flags', async () => {
            mockRedisSet.mockResolvedValue('OK');

            await lockService.acquireLock(CONV_ID, 3000);

            expect(mockRedisSet).toHaveBeenCalledWith(
                LOCK_KEY,
                expect.any(String),
                'PX',
                3000,
                'NX'
            );
        });

        it('should return success=false with LOCK_ALREADY_HELD when lock exists', async () => {
            mockRedisSet.mockResolvedValue(null); // NX returns null when key exists
            mockRedisPttl.mockResolvedValue(2500);

            const result = await lockService.acquireLock(CONV_ID);

            expect(result.success).toBe(false);
            expect(result.error).toBe('LOCK_ALREADY_HELD');
            expect(result.lockExpiresInMs).toBe(2500);
        });

        it('should call pttl to determine remaining lock TTL when lock is held', async () => {
            mockRedisSet.mockResolvedValue(null);
            mockRedisPttl.mockResolvedValue(1800);

            await lockService.acquireLock(CONV_ID);

            expect(mockRedisPttl).toHaveBeenCalledWith(LOCK_KEY);
        });

        it('should use the default timeout of 5000ms when not specified', async () => {
            mockRedisSet.mockResolvedValue('OK');

            const result = await lockService.acquireLock(CONV_ID);

            expect(mockRedisSet).toHaveBeenCalledWith(
                LOCK_KEY,
                expect.any(String),
                'PX',
                5000,
                'NX'
            );
            // expiresAt should be ~5000ms after acquiredAt
            expect(result.expiresAt - result.acquiredAt).toBe(5000);
        });

        it('should throw a wrapped Error when Redis throws', async () => {
            mockRedisSet.mockRejectedValue(new Error('Connection refused'));

            await expect(lockService.acquireLock(CONV_ID)).rejects.toThrow(
                'Failed to acquire conversation lock: Connection refused'
            );
        });

        it('should generate unique lockIds for concurrent calls', async () => {
            mockRedisSet.mockResolvedValue('OK');

            const [r1, r2] = await Promise.all([
                lockService.acquireLock(CONV_ID),
                lockService.acquireLock(CONV_ID)
            ]);

            // lockIds are generated from timestamp + random bytes — highly unlikely to collide
            expect(r1.lockId).not.toBe(r2.lockId);
        });
    });

    // =========================================================================
    // releaseLock
    // =========================================================================
    describe('releaseLock', () => {
        it('should return success=true when lockId matches and key is deleted', async () => {
            mockRedisEval.mockResolvedValue(1);

            const result = await lockService.releaseLock(CONV_ID, 'lock_123_abc');

            expect(result.success).toBe(true);
        });

        it('should execute Lua script for atomic check-and-delete', async () => {
            mockRedisEval.mockResolvedValue(1);

            await lockService.releaseLock(CONV_ID, 'lock_123_abc');

            expect(mockRedisEval).toHaveBeenCalledWith(
                expect.stringContaining('redis.call("get"'),
                1,
                LOCK_KEY,
                'lock_123_abc'
            );
        });

        it('should return success=false with LOCK_MISMATCH_OR_EXPIRED when eval returns 0', async () => {
            mockRedisEval.mockResolvedValue(0); // key not found or different lockId

            const result = await lockService.releaseLock(CONV_ID, 'stale_lock_id');

            expect(result.success).toBe(false);
            expect(result.error).toBe('LOCK_MISMATCH_OR_EXPIRED');
        });

        it('should not delete the lock when lockId does not match', async () => {
            mockRedisEval.mockResolvedValue(0);

            const result = await lockService.releaseLock(CONV_ID, 'wrong-lock-id');

            expect(result.success).toBe(false);
        });

        it('should throw a wrapped Error when Redis eval fails', async () => {
            mockRedisEval.mockRejectedValue(new Error('READONLY'));

            await expect(lockService.releaseLock(CONV_ID, 'lock-id')).rejects.toThrow(
                'Failed to release conversation lock: READONLY'
            );
        });

        it('should pass exactly 1 key to eval (Lua KEYS[1])', async () => {
            mockRedisEval.mockResolvedValue(1);

            await lockService.releaseLock(CONV_ID, 'my-lock');

            const [, numKeys] = mockRedisEval.mock.calls[0];
            expect(numKeys).toBe(1);
        });
    });

    // =========================================================================
    // isConversationLocked
    // =========================================================================
    describe('isConversationLocked', () => {
        it('should return isLocked=true with lockExpiresInMs when key exists', async () => {
            mockRedisExists.mockResolvedValue(1);
            mockRedisPttl.mockResolvedValue(3200);

            const result = await lockService.isConversationLocked(CONV_ID);

            expect(result.isLocked).toBe(true);
            expect(result.lockExpiresInMs).toBe(3200);
        });

        it('should return isLocked=false when key does not exist', async () => {
            mockRedisExists.mockResolvedValue(0);
            mockRedisPttl.mockResolvedValue(-2); // key doesn't exist

            const result = await lockService.isConversationLocked(CONV_ID);

            expect(result.isLocked).toBe(false);
        });

        it('should return lockExpiresInMs=null when pttl returns negative', async () => {
            mockRedisExists.mockResolvedValue(1);
            mockRedisPttl.mockResolvedValue(-1); // key exists but has no TTL

            const result = await lockService.isConversationLocked(CONV_ID);

            expect(result.lockExpiresInMs).toBeNull();
        });

        it('should query the correct Redis key format', async () => {
            mockRedisExists.mockResolvedValue(0);
            mockRedisPttl.mockResolvedValue(-2);

            await lockService.isConversationLocked(CONV_ID);

            expect(mockRedisExists).toHaveBeenCalledWith(LOCK_KEY);
        });

        it('should return isLocked=false with error message on Redis failure (non-throwing)', async () => {
            mockRedisExists.mockRejectedValue(new Error('Socket timeout'));

            const result = await lockService.isConversationLocked(CONV_ID);

            // Error is caught internally — does not throw
            expect(result.isLocked).toBe(false);
            expect(result.error).toBe('Socket timeout');
        });

        it('should check different conversations independently', async () => {
            mockRedisExists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
            mockRedisPttl.mockResolvedValueOnce(1000).mockResolvedValueOnce(-2);

            const r1 = await lockService.isConversationLocked('conv-A');
            const r2 = await lockService.isConversationLocked('conv-B');

            expect(r1.isLocked).toBe(true);
            expect(r2.isLocked).toBe(false);
        });
    });

    // =========================================================================
    // waitForLockRelease
    // =========================================================================
    describe('waitForLockRelease', () => {
        it('should return acquired=true immediately when lock is not held', async () => {
            mockRedisExists.mockResolvedValue(0);

            const result = await lockService.waitForLockRelease(CONV_ID, 1000);

            expect(result.acquired).toBe(true);
            expect(result.waitedMs).toBeGreaterThanOrEqual(0);
        });

        it('should poll until lock is released', async () => {
            // Lock held for first two polls, then released
            mockRedisExists
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0);

            const result = await lockService.waitForLockRelease(CONV_ID, 5000);

            expect(result.acquired).toBe(true);
            expect(mockRedisExists).toHaveBeenCalledTimes(3);
        }, 10000);

        it('should return acquired=false with TIMEOUT error when maxWaitMs exceeded', async () => {
            // Lock never released
            mockRedisExists.mockResolvedValue(1);

            const result = await lockService.waitForLockRelease(CONV_ID, 150);

            expect(result.acquired).toBe(false);
            expect(result.error).toBe('TIMEOUT');
            expect(result.waitedMs).toBe(150);
        }, 10000);

        it('should report approximately correct waitedMs on timeout', async () => {
            mockRedisExists.mockResolvedValue(1);

            const start = Date.now();
            const result = await lockService.waitForLockRelease(CONV_ID, 200);
            const elapsed = Date.now() - start;

            // waitedMs reported should match maxWaitMs on timeout
            expect(result.waitedMs).toBe(200);
            // Actual elapsed time should be close to 200ms (generous tolerance for CI)
            expect(elapsed).toBeGreaterThanOrEqual(150);
        }, 10000);

        it('should check the correct lock key during polling', async () => {
            mockRedisExists.mockResolvedValue(0);

            await lockService.waitForLockRelease('conv-poll-test', 500);

            expect(mockRedisExists).toHaveBeenCalledWith('lock:conversation:conv-poll-test');
        });

        it('should return acquired=true with low waitedMs when lock releases on first check', async () => {
            mockRedisExists.mockResolvedValue(0);

            const result = await lockService.waitForLockRelease(CONV_ID, 10000);

            expect(result.acquired).toBe(true);
            expect(mockRedisExists).toHaveBeenCalledTimes(1);
        });
    });
});
