/**
 * In-Memory Cache Configuration
 * Replaces Redis with local storage for development/testing
 */

const MemoryCache = require('./memory-cache').MemoryCache;

// Create singleton instances
const sessionCache = new MemoryCache();
const cacheMemory = new MemoryCache();
const rateLimitCache = new MemoryCache();
const legacyCache = new MemoryCache();

// Mock Redis clients for backward compatibility
const createMockRedisClient = (cache, name, dbName) => ({
    status: 'ready',
    get: (key) => cache.get(key),
    set: (key, value) => cache.set(key, value),
    setex: (key, ttl, value) => cache.setex(key, ttl, value),
    del: (...keys) => cache.del(...keys),
    exists: (key) => cache.exists(key),
    scan: (cursor, options) => cache.scan(cursor, options),
    flushall: () => cache.flushall(),
    quit: async () => {
        console.log(`📝 Memory ${name} (DB ${dbName}) connection closed`);
        return Promise.resolve();
    },
    on: (event, callback) => {
        if (event === 'connect') {
            setTimeout(() => callback(), 100); // Simulate connection
        }
    }
});

// Create Redis-like clients using memory cache
const sessionRedis = createMockRedisClient(sessionCache, 'Sessions', 0);
const cacheRedis = createMockRedisClient(cacheMemory, 'Cache', 1);
const rateLimitRedis = createMockRedisClient(rateLimitCache, 'RateLimit', 2);
const legacyRedis = createMockRedisClient(legacyCache, 'Legacy', 0);

/**
 * Close all memory cache connections gracefully
 */
async function closeAllRedis() {
    await Promise.all([
        sessionRedis.quit(),
        cacheRedis.quit(),
        rateLimitRedis.quit(),
        legacyRedis.quit()
    ]);
    console.log('📝 All memory cache connections closed');
}

/**
 * Check if memory cache clients are available
 */
function checkRedisAvailability() {
    return {
        session: sessionRedis.status === 'ready',
        cache: cacheRedis.status === 'ready',
        rateLimit: rateLimitRedis.status === 'ready',
        legacy: legacyRedis.status === 'ready'
    };
}

module.exports = {
    sessionRedis,
    cacheRedis,
    rateLimitRedis,
    legacyRedis,
    closeAllRedis,
    checkRedisAvailability
};
