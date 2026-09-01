'use strict';

const express = require('express');
const request = require('supertest');

const mockSequelize = { authenticate: jest.fn() };
const mockCacheRedis = {
    info: jest.fn(),
    get: jest.fn(),
};
const mockMalformedWebhookMetrics = Object.freeze({
    count: 4,
    lastAt: '2026-09-01T12:00:00.000Z',
});
const mockAuthenticate = jest.fn((_req, _res, next) => next());

jest.mock('../../utils/database/database-setup', () => ({ sequelize: mockSequelize }));
jest.mock('../../config/redis', () => ({
    checkRedisAvailability: jest.fn(() => ({ session: true })),
    cacheRedis: mockCacheRedis,
}));
jest.mock('../../middleware/auth.middleware', () => ({ authenticate: mockAuthenticate }));
jest.mock('../../modules/integration/meta-webhook-metrics', () => ({
    getMalformedWebhookMetrics: () => mockMalformedWebhookMetrics,
}));
jest.mock('../../jobs/queue-manager', () => ({
    getQueueStats: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
    getCriticalQueueStats: jest.fn().mockResolvedValue({ messageDlq: { waiting: 0 } }),
}));
jest.mock('../../modules/rag/embedding.service', () => ({
    getProviderInfo: jest.fn(() => ({
        effective: 'test',
        configured: false,
        semantic: false,
        keyPresent: false,
        vectorSize: null,
    })),
    probe: jest.fn().mockResolvedValue({ ok: true, dimensions: null }),
}));

global.fetch = jest.fn().mockResolvedValue({ ok: false });

const healthRouter = require('../health.routes');
const app = express();
app.use('/health', healthRouter);

beforeEach(() => {
    jest.clearAllMocks();
    mockSequelize.authenticate.mockResolvedValue(undefined);
    mockCacheRedis.info.mockResolvedValue('');
    mockCacheRedis.get.mockResolvedValue(null);
});

test('exposes only the safe malformed-webhook count and timestamp on authenticated detailed health', async () => {
    const response = await request(app)
        .get('/health/detailed')
        .expect(200);

    expect(mockAuthenticate).toHaveBeenCalled();
    expect(response.body.webhookMalformed).toEqual({
        count: 4,
        lastAt: '2026-09-01T12:00:00.000Z',
    });
    expect(Object.keys(response.body.webhookMalformed)).toEqual(['count', 'lastAt']);
    expect(response.body.webhookMalformed).not.toHaveProperty('bodySize');
    expect(response.body.webhookMalformed).not.toHaveProperty('bodyHash');
    expect(response.body.webhookMalformed).not.toHaveProperty('signatureValid');
});
