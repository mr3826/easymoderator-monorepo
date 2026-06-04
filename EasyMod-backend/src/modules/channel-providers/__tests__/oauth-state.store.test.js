'use strict';

// Force the in-memory fallback path (no real Redis in unit tests).
jest.mock('../../../config/redis', () => ({
    cacheRedis: { _isMemoryFallback: true }
}));

const store = require('../oauth-state.store');

describe('oauth-state.store (memory fallback)', () => {
    test('stores and consumes a payload exactly once', async () => {
        await store.put('state-1', { shopId: 's1', platform: 'unified' });
        const first = await store.take('state-1');
        expect(first).toMatchObject({ shopId: 's1', platform: 'unified' });
        const second = await store.take('state-1');
        expect(second).toBeNull(); // single-use
    });

    test('returns null for unknown state', async () => {
        expect(await store.take('nope')).toBeNull();
    });

    test('expires an entry after the TTL window', async () => {
        jest.useFakeTimers();
        const base = new Date('2026-01-01T00:00:00Z').getTime();
        jest.setSystemTime(base);
        await store.put('state-ttl', { shopId: 's2', platform: 'unified' });
        // Jump just past the 15-min TTL; the lazy read-time check should drop it.
        jest.setSystemTime(base + store.TTL_SECONDS * 1000 + 1);
        expect(await store.take('state-ttl')).toBeNull();
        jest.useRealTimers();
    });
});
