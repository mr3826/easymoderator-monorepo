'use strict';

const mockRedisStore = {};
const mockCacheRedis = {
    status: 'wait',
    _isMemoryFallback: false,
    connect: jest.fn(async () => {
        mockCacheRedis.status = 'ready';
        return mockCacheRedis;
    }),
    get: jest.fn(async (key) => mockRedisStore[key] || null),
    setex: jest.fn(async (key, _ttl, value) => {
        mockRedisStore[key] = value;
        return 'OK';
    }),
    set: jest.fn(async (key, value) => {
        mockRedisStore[key] = value;
        return 'OK';
    }),
};

jest.mock('../../config/redis.js', () => ({ cacheRedis: mockCacheRedis }));

const cacheService = require('../cache.service');

describe('strict cache readiness', () => {
    beforeEach(() => {
        Object.keys(mockRedisStore).forEach((key) => delete mockRedisStore[key]);
        mockCacheRedis.status = 'wait';
        mockCacheRedis._isMemoryFallback = false;
        jest.clearAllMocks();
    });

    it('connects a lazy Redis client before confirming a strict token-version write', async () => {
        await expect(cacheService.setStrict('user:user-1:token_version', 4, 60)).resolves.toBe(true);

        expect(mockCacheRedis.connect).toHaveBeenCalledTimes(1);
        await expect(cacheService.getStrict('user:user-1:token_version')).resolves.toBe(4);
    });

    it('continues to fail closed for the in-memory fallback', async () => {
        mockCacheRedis.status = 'ready';
        mockCacheRedis._isMemoryFallback = true;

        await expect(cacheService.setStrict('user:user-1:token_version', 4, 60))
            .rejects.toThrow('Redis cache is unavailable');
    });
});
