/**
 * In-Memory Cache Service
 * Replaces Redis-based caching with local storage
 */

class MemoryCache {
    constructor() {
        this.cache = new Map();
        this.ttls = new Map(); // Time-to-live
    }

    /**
     * Get value from cache
     */
    async get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        // Check TTL
        if (item.expiresAt && Date.now() > item.expiresAt) {
            this.cache.delete(key);
            this.ttls.delete(key);
            return null;
        }
        
        return item.value;
    }

    /**
     * Set value in cache with optional TTL
     */
    async set(key, value, ttlSeconds = null) {
        this.cache.set(key, { value });
        
        if (ttlSeconds) {
            this.ttls.set(key, Date.now() + (ttlSeconds * 1000));
        }
        
        return true;
    }

    /**
     * Set value with expiration
     */
    async setex(key, ttlSeconds, value) {
        return this.set(key, value, ttlSeconds);
    }

    /**
     * Delete key from cache
     */
    async del(key) {
        this.cache.delete(key);
        this.ttls.delete(key);
        return true;
    }

    /**
     * Delete multiple keys
     */
    async del(...keys) {
        for (const key of keys) {
            this.cache.delete(key);
            this.ttls.delete(key);
        }
        return true;
    }

    /**
     * Check if key exists
     */
    async exists(key) {
        const item = this.cache.get(key);
        if (!item) return 0;
        
        // Check TTL
        if (item.expiresAt && Date.now() > item.expiresAt) {
            this.cache.delete(key);
            this.ttls.delete(key);
            return 0;
        }
        
        return 1;
    }

    /**
     * Scan keys with pattern
     */
    async scan(cursor, options) {
        const pattern = options.MATCH || '*';
        const count = options.COUNT || 100;
        
        const keys = Array.from(this.cache.keys());
        const filteredKeys = keys.filter(key => {
            // Simple pattern matching (supports * wildcard)
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(key);
        });
        
        const startIndex = parseInt(cursor) || 0;
        const endIndex = Math.min(startIndex + count, filteredKeys.length);
        const pageKeys = filteredKeys.slice(startIndex, endIndex);
        
        const nextCursor = endIndex >= filteredKeys.length ? '0' : endIndex.toString();
        
        return [nextCursor, pageKeys];
    }

    /**
     * Clear all cache
     */
    async flushall() {
        this.cache.clear();
        this.ttls.clear();
        return true;
    }
}

// Create singleton instances
const sessionCache = new MemoryCache();
const cacheMemory = new MemoryCache();
const rateLimitCache = new MemoryCache();
const legacyCache = new MemoryCache();

/**
 * Simulate Redis client status
 */
const createMockRedisClient = (name, dbName) => {
    const cache = name === 'Sessions' ? sessionCache :
                   name === 'Cache' ? cacheMemory :
                   name === 'RateLimit' ? rateLimitCache :
                   legacyCache;

    return {
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
    };
};

module.exports = {
    MemoryCache,
    sessionRedis: createMockRedisClient('Sessions', 0),
    cacheRedis: createMockRedisClient('Cache', 1),
    rateLimitRedis: createMockRedisClient(rateLimitCache, 'RateLimit', 2),
    legacyRedis: createMockRedisClient('Legacy', 0),
    closeAllRedis: async () => {
        await Promise.all([
            sessionCache.flushall(),
            cacheMemory.flushall(),
            rateLimitCache.flushall(),
            legacyCache.flushall()
        ]);
        console.log('📝 All memory cache connections closed');
    },
    checkRedisAvailability: () => ({
        session: true,
        cache: true,
        rateLimit: true,
        legacy: true
    })
};
