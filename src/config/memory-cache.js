/**
 * In-Memory Cache Service
 * Replaces Redis-based caching with local storage
 */

class MemoryCache {
    constructor() {
        this.cache = new Map();
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
     * Set value. Supports Redis-style variadic args: SET key value [NX] [EX seconds]
     */
    async set(key, value, ...args) {
        let nx = false;
        let ttlSeconds = null;

        for (let i = 0; i < args.length; i++) {
            const arg = typeof args[i] === 'string' ? args[i].toUpperCase() : args[i];
            if (arg === 'NX') { nx = true; }
            else if (arg === 'EX' && args[i + 1] != null) { ttlSeconds = parseInt(args[i + 1]); i++; }
            else if (arg === 'PX' && args[i + 1] != null) { ttlSeconds = parseInt(args[i + 1]) / 1000; i++; }
            // Legacy positional: set(key, value, ttlSeconds) where ttlSeconds is a number
            else if (typeof arg === 'number') { ttlSeconds = arg; }
        }

        if (nx) {
            const existing = await this.get(key);
            if (existing !== null) return null; // NX failed — key exists
        }

        const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
        this.cache.set(key, { value, expiresAt });
        return 'OK';
    }

    /**
     * Set value with expiration (SETEX compatibility)
     */
    async setex(key, ttlSeconds, value) {
        const expiresAt = Date.now() + ttlSeconds * 1000;
        this.cache.set(key, { value, expiresAt });
        return 'OK';
    }

    /**
     * Delete one or more keys
     */
    async del(...keys) {
        for (const key of keys) {
            this.cache.delete(key);
        }
        return keys.length;
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
        return 'OK';
    }
}

module.exports = { MemoryCache };
