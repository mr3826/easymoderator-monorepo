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
            sameSite: 'lax' // Use 'lax' for better SameSite handling; strict breaks cross-origin scenarios
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
        if (config.env === 'production' || config.env === 'staging') {
            throw new Error('Redis is required for sessions in production/staging');
        }
        console.warn('⚠️  Session store: Memory (not recommended for production)');
    }

    return session(sessionConfig);
}

module.exports = createSessionMiddleware;
