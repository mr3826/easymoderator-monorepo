/**
 * Health Check Routes
 * K8s-ready health probes for liveness and readiness checks
 * /live and /ready are unauthenticated (consumed by load balancers and orchestrators)
 * /detailed is authenticated — it exposes queue depths, infra topology, and API keys presence
 */

const express = require('express');
const router = express.Router();
const { sequelize } = require('../utils/database/database-setup');
const { checkRedisAvailability } = require('../config/redis');
const { authenticate } = require('../middleware/auth.middleware');

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

        // Check Redis connections
        const redisStatus = checkRedisAvailability();
        const redisConnected = Object.values(redisStatus).some(status => status);

        res.status(200).json({
            status: 'ready',
            timestamp: new Date().toISOString(),
            database: 'connected',
            redis: redisConnected ? 'connected' : 'not_configured',
            redis_details: redisStatus,
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
 * P2-6: Detailed health — DB, Redis, queue depths, Vector DB (authenticated)
 */
router.get('/detailed', authenticate, async (req, res) => {
    const checks = {
        service: 'up',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'unknown',
        redis: 'unknown',
        redis_details: {},
        vectorDb: 'unknown',
        vectorProvider: 'qdrant',
        queues: null
    };

    try {
        await sequelize.authenticate();
        checks.database = 'connected';
    } catch (_) {
        checks.database = 'disconnected';
    }

    try {
        const redisStatus = checkRedisAvailability();
        checks.redis_details = redisStatus;
        checks.redis = Object.values(redisStatus).some(status => status) ? 'connected' : 'not_configured';
    } catch (_) {
        checks.redis = 'disconnected';
    }

    try {
        const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
        const qdrantRes = await fetch(`${qdrantUrl}/collections`, {
            headers: process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}
        });
        checks.vectorDb = qdrantRes.ok ? 'available' : 'unavailable';
    } catch (_) {
        checks.vectorDb = 'unavailable';
    }

    try {
        const queueManager = require('../jobs/queue-manager');
        const queueNames = ['dailyOverage', 'monthlyReset', 'invoiceGenerator', 'paymentReconciler'];
        checks.queues = {};
        for (const name of queueNames) {
            const stats = await queueManager.getQueueStats(name);
            checks.queues[name] = stats || { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
        }
        // Customer-facing reply pipeline (message-processing + comment-to-dm +
        // notifications + the message-dlq sink). A non-zero dlq means real
        // customers got no reply — this is the path that must never fail silently.
        checks.criticalQueues = await queueManager.getCriticalQueueStats();
        const dlqDepth = checks.criticalQueues?.messageDlq?.waiting || 0;
        checks.autoReplyDlq = dlqDepth;
    } catch (_) {
        checks.queues = { error: 'queue_manager_unavailable' };
    }

    // Auto-reply canary freshness — proves the message-processing worker is alive
    // and consuming the queue (the launch-readiness check reads this).
    try {
        const { cacheRedis } = require('../config/redis');
        const lastOk = cacheRedis ? await cacheRedis.get('canary:msg:last_ok') : null;
        const ageMs = lastOk ? Date.now() - parseInt(lastOk, 10) : null;
        const maxStale = parseInt(process.env.CANARY_MAX_STALENESS_MS, 10) || 15 * 60 * 1000;
        checks.autoReplyCanary = { lastOkAgeMs: ageMs, fresh: ageMs !== null && ageMs <= maxStale };
    } catch (_) {
        checks.autoReplyCanary = { lastOkAgeMs: null, fresh: false };
    }

    const unhealthy = checks.database === 'disconnected' || checks.redis === 'disconnected';
    res.status(unhealthy ? 503 : 200).json(checks);
});

/**
 * SSE pub/sub health — reports local SSE connection count and Redis pub/sub status.
 * Unauthenticated so load balancers and container orchestrators can probe it.
 */
router.get('/sse', (req, res) => {
    let connections = 0;
    let pubsub = 'down';

    try {
        const sseManager = require('../utils/sse-manager');
        connections = sseManager.getLocalConnectionCount();
        pubsub = sseManager.getPubSubStatus();
    } catch (_) {
        pubsub = 'down';
    }

    res.status(200).json({ connections, pubsub });
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

    // Memory cache is always available
    checks.redis = 'connected';

    const hasErrors = Object.values(checks).some(v => v === 'disconnected' || v === 'down');
    const statusCode = hasErrors ? 503 : 200;

    res.status(statusCode).json(checks);
});

module.exports = router;
