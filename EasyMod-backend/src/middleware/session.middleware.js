const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { getRedisClient } = require('../utils/redis-client');
const config = require('../config/config');

/**
 * Session middleware using Redis for storage in production
 * Falls back to memory store in development if Redis not available
 */
function createSessionMiddleware() {
    const sessionConfig = {
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: true, // CRITICAL: Always save session immediately for CSRF token stability (P2-3: CSRF requires stable session ID)
        name: 'commerce_ai.sid',
        cookie: {
            secure: config.env === 'production', // HTTPS only in production
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
            // app.easymod.tech → api.easymod.tech is cross-origin but same-site,
            // so Lax preserves the session without exposing it cross-site.
            sameSite: 'lax'
        }
    };

    // Use Redis store if available
    const redisClient = getRedisClient();
    if (redisClient) {
        sessionConfig.store = new RedisStore({
            client: redisClient,
            prefix: 'sess:',
            ttl: 60 * 60 * 24 * 7 // 7 days in seconds
        });
        console.log('✅ Session store: Redis');
    } else {
        if (config.env === 'production') {
            throw new Error('Redis is required for sessions in production');
        }
        if (config.env === 'staging') {
            console.warn('⚠️  Session store: Memory (using in-memory for staging test)');
        } else {
            console.warn('⚠️  Session store: Memory (not recommended for production)');
        }
    }

    return session(sessionConfig);
}

module.exports = createSessionMiddleware;
