'use strict';

const { Queue } = require('bullmq');
const config = require('../config/config');

function buildConnection() {
    const base = {
        db: 3, // Dedicated DB — separate from Bull queues (DB 0) and app cache (DB 1)
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: false,   // Required by BullMQ
    };

    if (config.redisUrl) {
        try {
            const parsed = new URL(config.redisUrl);
            const conn = {
                ...base,
                host: parsed.hostname,
                port: parseInt(parsed.port) || 6379,
            };
            if (parsed.password) conn.password = decodeURIComponent(parsed.password);
            if (parsed.protocol === 'rediss:') conn.tls = { rejectUnauthorized: false };
            return conn;
        } catch (_) { /* fall through */ }
    }

    return {
        ...base,
        host: config.redisHost || 'localhost',
        port: parseInt(config.redisPort) || 6379,
        ...(config.redisPassword ? { password: config.redisPassword } : {}),
    };
}

const connection = buildConnection();

const messageQueue = new Queue('message-processing', {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }, // 2s → 4s → 8s
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 }, // DLQ: retain last 500 failed jobs
    },
});

messageQueue.on('error', (err) => {
    console.error('[messageQueue] Queue error:', err.message);
});

module.exports = { messageQueue, connection };
