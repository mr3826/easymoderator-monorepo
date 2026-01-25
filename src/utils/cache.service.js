const { getRedisClient } = require('./redis-client');

/**
 * Cache Service - Abstraction over Redis for caching
 * Falls back to in-memory cache if Redis unavailable
 */
class CacheService {
    constructor() {
        this.memoryCache = new Map();
        this.redis = getRedisClient();
    }

    /**
     * Get value from cache
     * @param {string} key 
     * @returns {Promise<any|null>}
     */
    async get(key) {
        try {
            if (this.redis) {
                const value = await this.redis.get(key);
                return value ? JSON.parse(value) : null;
            }
            // Fallback to memory cache
            return this.memoryCache.get(key) || null;
        } catch (error) {
            console.error('Cache get error:', error);
            return null;
        }
    }

    /**
     * Set value in cache with optional TTL
     * @param {string} key 
     * @param {any} value 
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<boolean>}
     */
    async set(key, value, ttl = null) {
        try {
            const serialized = JSON.stringify(value);
            
            if (this.redis) {
                if (ttl) {
                    await this.redis.setex(key, ttl, serialized);
                } else {
                    await this.redis.set(key, serialized);
                }
                return true;
            }
            
            // Fallback to memory cache
            this.memoryCache.set(key, value);
            if (ttl) {
                setTimeout(() => this.memoryCache.delete(key), ttl * 1000);
            }
            return true;
        } catch (error) {
            console.error('Cache set error:', error);
            return false;
        }
    }

    /**
     * Delete value from cache
     * @param {string} key 
     * @returns {Promise<boolean>}
     */
    async delete(key) {
        try {
            if (this.redis) {
                await this.redis.del(key);
                return true;
            }
            return this.memoryCache.delete(key);
        } catch (error) {
            console.error('Cache delete error:', error);
            return false;
        }
    }

    /**
     * Delete multiple keys matching pattern
     * @param {string} pattern - Redis pattern (e.g., 'user:*')
     * @returns {Promise<number>} Number of keys deleted
     */
    async deletePattern(pattern) {
        try {
            if (this.redis) {
                const keys = await this.redis.keys(pattern);
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
                return keys.length;
            }
            // Memory cache doesn't support patterns efficiently
            return 0;
        } catch (error) {
            console.error('Cache delete pattern error:', error);
            return 0;
        }
    }

    /**
     * Check if key exists
     * @param {string} key 
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        try {
            if (this.redis) {
                const result = await this.redis.exists(key);
                return result === 1;
            }
            return this.memoryCache.has(key);
        } catch (error) {
            console.error('Cache exists error:', error);
            return false;
        }
    }

    /**
     * Set expiration on existing key
     * @param {string} key 
     * @param {number} ttl - Seconds
     * @returns {Promise<boolean>}
     */
    async expire(key, ttl) {
        try {
            if (this.redis) {
                await this.redis.expire(key, ttl);
                return true;
            }
            // Memory cache TTL requires re-setting
            const value = this.memoryCache.get(key);
            if (value) {
                setTimeout(() => this.memoryCache.delete(key), ttl * 1000);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Cache expire error:', error);
            return false;
        }
    }

    /**
     * Clear all cache (use with caution)
     * @returns {Promise<boolean>}
     */
    async clear() {
        try {
            if (this.redis) {
                await this.redis.flushdb();
                return true;
            }
            this.memoryCache.clear();
            return true;
        } catch (error) {
            console.error('Cache clear error:', error);
            return false;
        }
    }

    /**
     * Increment numeric value
     * @param {string} key 
     * @param {number} amount 
     * @returns {Promise<number>} New value
     */
    async increment(key, amount = 1) {
        try {
            if (this.redis) {
                return await this.redis.incrby(key, amount);
            }
            const current = this.memoryCache.get(key) || 0;
            const newValue = current + amount;
            this.memoryCache.set(key, newValue);
            return newValue;
        } catch (error) {
            console.error('Cache increment error:', error);
            return 0;
        }
    }
}

// Export singleton instance
module.exports = new CacheService();
