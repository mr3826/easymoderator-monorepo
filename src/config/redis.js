/**
 * Redis configuration.
 * Uses real ioredis when REDIS_URL or REDIS_HOST is set in the environment.
 * Falls back to in-memory cache for local development (single-process only —
 * distributed locks and cross-instance caching DO NOT work in fallback mode).
 */

const config = require('./config');
const { MemoryCache } = require('./memory-cache');

const hasRedisConfig = !!(
    process.env.REDIS_URL ||
    (config.redisHost && config.redisHost !== 'localhost' && config.redisHost !== '127.0.0.1')
);

// Allow staging to use memory store if Redis not explicitly configured
const forceMemoryStore = (config.env === 'staging' || config.env === 'development') && !process.env.REDIS_URL;

// DEBUG
if (config.env === 'staging' || config.env === 'development') {
    console.log(`[REDIS DEBUG] env=${config.env}, REDIS_URL=${process.env.REDIS_URL}, redisHost=${config.redisHost}, hasRedisConfig=${hasRedisConfig}, forceMemoryStore=${forceMemoryStore}`);
}

let sessionRedis, cacheRedis, rateLimitRedis, legacyRedis;

if (hasRedisConfig && !forceMemoryStore) {
    const Redis = require('ioredis');

    const baseOpts = config.redisUrl
        ? { lazyConnect: true, maxRetriesPerRequest: 3, enableReadyCheck: true }
        : {
            host: config.redisHost,
            port: parseInt(config.redisPort) || 6379,
            password: config.redisPassword || undefined,
            lazyConnect: true,
            maxRetriesPerRequest: 3,
            enableReadyCheck: true
        };

    const createClient = (db, name) => {
        const opts = config.redisUrl
            ? { ...baseOpts, db }
            : { ...baseOpts, db };

        const client = config.redisUrl
            ? new Redis(config.redisUrl, opts)
            : new Redis(opts);

        client.on('connect', () => console.log(`✅ Redis ${name} (DB ${db}) connected`));
        client.on('error', (err) => console.error(`❌ Redis ${name} error:`, err.message));
        return client;
    };

    sessionRedis  = createClient(parseInt(config.redisSessionDb)  || 0, 'Sessions');
    cacheRedis    = createClient(parseInt(config.redisCacheDb)    || 1, 'Cache');
    rateLimitRedis= createClient(parseInt(config.redisRateLimitDb)|| 2, 'RateLimit');
    legacyRedis   = createClient(0, 'Legacy');

    console.log('🔴 Redis clients initialised (real ioredis)');
} else {
    // Development / no-Redis fallback
    console.warn(
        '⚠️  Redis not configured — using in-memory cache.\n' +
        '   Distributed job locks and cross-process caching are DISABLED.\n' +
        '   Set REDIS_URL or REDIS_HOST to enable real Redis.'
    );

    const createMockClient = (cache) => ({
        // Expose the MemoryCache instance so callers that need the real client can detect it
        _isMemoryFallback: true,
        status: 'ready',

        get:     (key)            => cache.get(key),
        set:     (key, val, ...a) => cache.set(key, val, ...a),
        setex:   (key, ttl, val)  => cache.setex(key, ttl, val),
        del:     (...keys)        => cache.del(...keys),
        exists:  (key)            => cache.exists(key),
        scan:    (cursor, opts)   => cache.scan(cursor, opts),
        flushall:()               => cache.flushall(),
        quit:    async ()         => Promise.resolve('OK'),
        on:      (event, cb)      => { if (event === 'connect') setTimeout(cb, 10); }
    });

    sessionRedis   = createMockClient(new MemoryCache());
    cacheRedis     = createMockClient(new MemoryCache());
    rateLimitRedis = createMockClient(new MemoryCache());
    legacyRedis    = createMockClient(new MemoryCache());
}

async function closeAllRedis() {
    await Promise.all(
        [sessionRedis, cacheRedis, rateLimitRedis, legacyRedis]
            .map(c => c.quit?.().catch(() => {}))
    );
    console.log('Redis connections closed');
}

function checkRedisAvailability() {
    const ready = (c) => c.status === 'ready' || c._isMemoryFallback === true;
    return {
        session:   ready(sessionRedis),
        cache:     ready(cacheRedis),
        rateLimit: ready(rateLimitRedis),
        legacy:    ready(legacyRedis)
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
