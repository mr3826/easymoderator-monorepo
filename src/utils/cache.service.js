const { getRedisClient } = require('./redis-client');

// In-memory fallback: evict oldest entries when this limit is reached
const MAX_MEMORY_ENTRIES = 10000;

/**
 * Cache Service — Redis-backed with in-memory fallback.
 *
 * TENANT ISOLATION
 * ─────────────────
 * All callers SHOULD use the tenant-scoped API:
 *   cache.getForShop(shopId, key)
 *   cache.setForShop(shopId, key, value, ttl)
 *   cache.deleteForShop(shopId, key)
 *   cache.deletePatternForShop(shopId, pattern)
 *   cache.clearForShop(shopId)
 *
 * The legacy un-scoped methods (get/set/delete/deletePattern/clear) are kept for
 * backward compatibility but are NOT tenant-isolated. Migrate callers to the
 * scoped API when touching those code paths.
 */
class CacheService {
    constructor() {
        this.memoryCache = new Map();
    }

    // ─── Internal helpers ───────────────────────────────────────────────────────

    /**
     * Build a tenant-namespaced Redis key.
     * Format: t:{shopId}:{key}
     */
    _tenantKey(shopId, key) {
        return `t:${shopId}:${key}`;
    }

    /**
     * Core get — works on any raw Redis key.
     */
    async _get(rawKey) {
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                const value = await redis.get(rawKey);
                return value ? JSON.parse(value) : null;
            }
            return this.memoryCache.get(rawKey) ?? null;
        } catch (error) {
            console.error('Cache get error:', error);
            return null;
        }
    }

    /**
     * Core set — works on any raw Redis key.
     */
    async _set(rawKey, value, ttl = null) {
        try {
            const serialized = JSON.stringify(value);
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                if (ttl) {
                    await redis.setex(rawKey, ttl, serialized);
                } else {
                    await redis.set(rawKey, serialized);
                }
                return true;
            }
            // In-memory fallback: evict LRU entry when at capacity
            if (this.memoryCache.size >= MAX_MEMORY_ENTRIES) {
                const firstKey = this.memoryCache.keys().next().value;
                this.memoryCache.delete(firstKey);
            }
            this.memoryCache.set(rawKey, value);
            if (ttl) {
                setTimeout(() => this.memoryCache.delete(rawKey), ttl * 1000);
            }
            return true;
        } catch (error) {
            console.error('Cache set error:', error);
            return false;
        }
    }

    /**
     * Core delete — works on any raw Redis key.
     */
    async _delete(rawKey) {
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                await redis.del(rawKey);
                return true;
            }
            return this.memoryCache.delete(rawKey);
        } catch (error) {
            console.error('Cache delete error:', error);
            return false;
        }
    }

    /**
     * Core pattern delete using SCAN (non-blocking, safe at scale).
     * NEVER uses KEYS * which blocks the Redis event loop.
     */
    async _deletePattern(rawPattern) {
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                let cursor = '0';
                let deleted = 0;
                do {
                    const [nextCursor, keys] = await redis.scan(
                        cursor, 'MATCH', rawPattern, 'COUNT', 100
                    );
                    cursor = nextCursor;
                    if (keys.length > 0) {
                        await redis.del(...keys);
                        deleted += keys.length;
                    }
                } while (cursor !== '0');
                return deleted;
            }
            // Memory cache: iterate and delete matching keys
            let deleted = 0;
            const patternRegex = new RegExp(
                '^' + rawPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
            );
            for (const k of this.memoryCache.keys()) {
                if (patternRegex.test(k)) {
                    this.memoryCache.delete(k);
                    deleted++;
                }
            }
            return deleted;
        } catch (error) {
            console.error('Cache deletePattern error:', error);
            return 0;
        }
    }

    // ─── Tenant-scoped API (preferred) ──────────────────────────────────────────

    /**
     * Get a tenant-scoped cache value.
     * @param {string} shopId - Tenant identifier
     * @param {string} key
     */
    async getForShop(shopId, key) {
        return this._get(this._tenantKey(shopId, key));
    }

    /**
     * Set a tenant-scoped cache value.
     * @param {string} shopId - Tenant identifier
     * @param {string} key
     * @param {any} value
     * @param {number} [ttl] - Seconds
     */
    async setForShop(shopId, key, value, ttl = null) {
        return this._set(this._tenantKey(shopId, key), value, ttl);
    }

    /**
     * Delete a tenant-scoped cache entry.
     */
    async deleteForShop(shopId, key) {
        return this._delete(this._tenantKey(shopId, key));
    }

    /**
     * Delete tenant-scoped entries matching a pattern (SCAN-based, non-blocking).
     * @param {string} shopId - Tenant identifier
     * @param {string} pattern - Glob pattern relative to tenant namespace (e.g. 'product:*')
     */
    async deletePatternForShop(shopId, pattern) {
        return this._deletePattern(this._tenantKey(shopId, pattern));
    }

    /**
     * Clear ALL cache entries for a single tenant.
     * Safe: only removes keys prefixed with t:{shopId}: — no cross-tenant impact.
     */
    async clearForShop(shopId) {
        return this._deletePattern(`t:${shopId}:*`);
    }

    /**
     * Check if a tenant-scoped key exists.
     */
    async existsForShop(shopId, key) {
        try {
            const rawKey = this._tenantKey(shopId, key);
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                return (await redis.exists(rawKey)) === 1;
            }
            return this.memoryCache.has(rawKey);
        } catch (error) {
            console.error('Cache existsForShop error:', error);
            return false;
        }
    }

    /**
     * Increment a tenant-scoped numeric counter.
     */
    async incrementForShop(shopId, key, amount = 1) {
        try {
            const rawKey = this._tenantKey(shopId, key);
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                return await redis.incrby(rawKey, amount);
            }
            const current = this.memoryCache.get(rawKey) || 0;
            const newValue = current + amount;
            this.memoryCache.set(rawKey, newValue);
            return newValue;
        } catch (error) {
            console.error('Cache incrementForShop error:', error);
            return 0;
        }
    }

    // ─── Legacy un-scoped API (backward compatible, not tenant-isolated) ─────────

    async get(key) { return this._get(key); }

    async set(key, value, ttl = null) { return this._set(key, value, ttl); }

    async delete(key) { return this._delete(key); }

    /**
     * Delete keys matching a pattern.
     * Fixed: uses SCAN cursor instead of blocking KEYS *.
     */
    async deletePattern(pattern) { return this._deletePattern(pattern); }

    async exists(key) {
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') return (await redis.exists(key)) === 1;
            return this.memoryCache.has(key);
        } catch (error) {
            console.error('Cache exists error:', error);
            return false;
        }
    }

    async expire(key, ttl) {
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') { await redis.expire(key, ttl); return true; }
            const value = this.memoryCache.get(key);
            if (value !== undefined) {
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
     * @deprecated NEVER calls redis.flushdb() — that would wipe ALL tenants' data.
     * Use clearForShop(shopId) to clear a specific tenant's cache instead.
     */
    async clear() {
        console.error(
            '[CacheService] cache.clear() is disabled — it would wipe all tenants. ' +
            'Use cache.clearForShop(shopId) to clear a single tenant.'
        );
        // Only clear the in-memory fallback; never touch Redis here
        this.memoryCache.clear();
        return false;
    }

    async increment(key, amount = 1) {
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') return await redis.incrby(key, amount);
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
