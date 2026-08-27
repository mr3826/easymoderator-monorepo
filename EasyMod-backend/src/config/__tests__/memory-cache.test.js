'use strict';

/**
 * Expiry used to throw.
 *
 * get()/exists() cleared a `this.ttls` map that does not exist, so the FIRST
 * read of an aged-out key raised "Cannot read properties of undefined". The
 * intent router's response cache calls get() on the hot path, so that TypeError
 * propagated out of route() and dropped the reply to the keyword responder.
 * Found by tests/meta-e2e — see docs/testing/META_E2E_TEST_SETUP.md.
 */

const { MemoryCache } = require('../memory-cache');

test('an expired key reads as a miss instead of throwing', async () => {
    const cache = new MemoryCache();
    await cache.setex('k', -1, 'v'); // already past its expiry

    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.exists('k')).resolves.toBe(0);
});

test('a live key still reads back', async () => {
    const cache = new MemoryCache();
    await cache.setex('k', 60, 'v');

    await expect(cache.get('k')).resolves.toBe('v');
    await expect(cache.exists('k')).resolves.toBe(1);
});

test('Redis-compatible increment persists a numeric tenant generation', async () => {
    const cache = new MemoryCache();

    await expect(cache.incrby('generation', 1)).resolves.toBe(1);
    await expect(cache.incrby('generation', 2)).resolves.toBe(3);
    await expect(cache.get('generation')).resolves.toBe(3);
});
