/**
 * Health Check Routes
 * K8s-ready health probes for liveness and readiness checks
 * No authentication required for these endpoints
 */

const express = require('express');
const router = express.Router();
const { sequelize } = require('../utils/database/database-setup');
const { getRedisClient } = require('../utils/redis-client');

/**
 * Liveness probe - Is the service responding?
 * Fast check, should fail immediately if service is dead
 */
router.get('/live', (req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

/**
 * Readiness probe - Is the service ready to handle requests?
 * Includes database connectivity check
 */
router.get('/ready', async (req, res) => {
    try {
        // Check database connection
        await sequelize.authenticate();

        // Check Redis connection
        const redis = getRedisClient();
        if (redis) {
            await redis.ping();
        }

        res.status(200).json({
            status: 'ready',
            timestamp: new Date().toISOString(),
            database: 'connected',
            redis: redis ? 'connected' : 'not_configured',
            version: process.env.APP_VERSION || '1.0.0'
        });
    } catch (error) {
        res.status(503).json({
            status: 'not_ready',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            redis: 'disconnected',
            error: error.message
        });
    }
});

/**
 * Full health check endpoint with detailed metrics
 */
router.get('/health', async (req, res) => {
    const checks = {
        service: 'up',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        environment: process.env.NODE_ENV || 'development'
    };

    try {
        await sequelize.authenticate();
        checks.database = 'connected';
    } catch (error) {
        checks.database = 'disconnected';
        checks.database_error = error.message;
    }

    try {
        const redis = getRedisClient();
        if (redis) {
            await redis.ping();
            checks.redis = 'connected';
        } else {
            checks.redis = 'not_configured';
        }
    } catch (error) {
        checks.redis = 'disconnected';
        checks.redis_error = error.message;
    }

    const hasErrors = Object.values(checks).some(v => v === 'disconnected' || v === 'down');
    const statusCode = hasErrors ? 503 : 200;

    res.status(statusCode).json(checks);
});

module.exports = router;
