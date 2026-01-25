const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { getRedisClient } = require('src/utils/redis-client');
const config = require('src/config/config');

/**
 * Session middleware using Redis for storage in production
 * Falls back to memory store in development if Redis not available
 */
function createSessionMiddleware() {
    const sessionConfig = {
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        name: 'commerce_ai.sid',
        cookie: {
            secure: config.env === 'production', // HTTPS only in production
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
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
        console.warn('⚠️  Session store: Memory (not recommended for production)');
    }

    return session(sessionConfig);
}

module.exports = createSessionMiddleware;
