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
});
