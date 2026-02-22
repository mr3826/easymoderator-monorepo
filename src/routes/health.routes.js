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
        // Do NOT include error.message — this endpoint is unauthenticated and
        // error messages can expose connection strings, DB hostnames, or credentials.
        res.status(503).json({
            status: 'not_ready',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            redis: 'disconnected'
        });
    }
});

/**
 * P2-6: Detailed health — DB, Redis, queue depths, Qdrant
 */
router.get('/detailed', async (req, res) => {
    const checks = {
        service: 'up',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'unknown',
        redis: 'unknown',
        qdrant: 'unknown',
        queues: null
    };

    try {
        await sequelize.authenticate();
        checks.database = 'connected';
    } catch (_) {
        checks.database = 'disconnected';
    }

    try {
        const redis = getRedisClient();
        if (redis) {
            await redis.ping();
            checks.redis = 'connected';
        } else {
            checks.redis = 'not_configured';
        }
    } catch (_) {
        checks.redis = 'disconnected';
    }

    try {
        const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
        const qdrantRes = await fetch(`${qdrantUrl}/collections`, {
            headers: process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}
        });
        checks.qdrant = qdrantRes.ok ? 'available' : 'unavailable';
    } catch (_) {
        checks.qdrant = 'unavailable';
    }

    try {
        const queueManager = require('../jobs/queue-manager');
        const queueNames = ['dailyOverage', 'monthlyReset', 'invoiceGenerator', 'paymentReconciler'];
        checks.queues = {};
        for (const name of queueNames) {
            const stats = await queueManager.getQueueStats(name);
            checks.queues[name] = stats || { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
        }
    } catch (_) {
        checks.queues = { error: 'queue_manager_unavailable' };
    }

    const unhealthy = checks.database === 'disconnected' || checks.redis === 'disconnected';
    res.status(unhealthy ? 503 : 200).json(checks);
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
    } catch (_error) {
        // Do NOT expose error.message — this endpoint is unauthenticated.
        // Log internally; return only a generic status code to callers.
        checks.database = 'disconnected';
    }

    try {
        const redis = getRedisClient();
        if (redis) {
            await redis.ping();
            checks.redis = 'connected';
        } else {
            checks.redis = 'not_configured';
        }
    } catch (_error) {
        checks.redis = 'disconnected';
    }

    const hasErrors = Object.values(checks).some(v => v === 'disconnected' || v === 'down');
    const statusCode = hasErrors ? 503 : 200;

    res.status(statusCode).json(checks);
});

module.exports = router;
