const Redis = require('ioredis');
const config = require('src/config/config');

let redisClient = null;

/**
 * Initialize Redis client with connection handling
 * @returns {Redis} Redis client instance
 */
function getRedisClient() {
    if (redisClient) {
        return redisClient;
    }

    // Skip Redis in development if not configured
    if (!config.redisUrl && config.env === 'development') {
        console.warn('⚠️  Redis not configured - using in-memory fallback for development');
        return null;
    }

    if (!config.redisUrl) {
        throw new Error('REDIS_URL is required in production');
    }

    try {
        redisClient = new Redis(config.redisUrl, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            reconnectOnError(err) {
                const targetError = 'READONLY';
                if (err.message.includes(targetError)) {
                    // Reconnect when Redis is in READONLY mode
                    return true;
                }
                return false;
            }
        });

        redisClient.on('connect', () => {
            console.log('✅ Redis connected successfully');
        });

        redisClient.on('error', (err) => {
            console.error('❌ Redis connection error:', err.message);
        });

        redisClient.on('ready', () => {
            console.log('✅ Redis ready for commands');
        });

        redisClient.on('reconnecting', () => {
            console.log('🔄 Redis reconnecting...');
        });

        return redisClient;
    } catch (error) {
        console.error('Failed to initialize Redis client:', error);
        throw error;
    }
}

/**
 * Close Redis connection gracefully
 */
async function closeRedis() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        console.log('Redis connection closed');
    }
}

/**
 * Check if Redis is available
 * @returns {boolean}
 */
function isRedisAvailable() {
    return redisClient && redisClient.status === 'ready';
}

module.exports = {
    getRedisClient,
    closeRedis,
    isRedisAvailable
};
