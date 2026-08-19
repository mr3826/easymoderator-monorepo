'use strict';

const express = require('express');
const request = require('supertest');

const mockRecordFunnelEvent = jest.fn();

jest.mock('../knowledge-gap.entity', () => ({ create: jest.fn(), findAll: jest.fn() }));
jest.mock('../analytics-enhanced.service', () => ({}));
jest.mock('../growth-metrics.service', () => ({ getGrowthMetrics: jest.fn() }));
jest.mock('../../growth-os/growth-os.middleware', () => ({
    requireGrowthOsAccess: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: jest.fn((req, res, next) => next()),
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: { query: jest.fn(), transaction: jest.fn() },
}));
jest.mock('../../entities', () => ({ AuditLog: { create: jest.fn() } }));
jest.mock('../funnel-events.service', () => ({
    ALLOWED_FUNNEL_EVENTS: new Set(['landing_view', 'signup_started']),
    recordFunnelEvent: mockRecordFunnelEvent,
}));

const router = require('../analytics.routes');

const app = express();
app.use(express.json());
app.use('/api/analytics', router);

describe('POST /api/analytics/funnel hardening', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRecordFunnelEvent.mockResolvedValue({ id: 'funnel-row-1' });
    });

    test('rejects invalid payload shapes before the service', async () => {
        const response = await request(app)
            .post('/api/analytics/funnel')
            .send({ event: 'landing_view', metadata: [] })
            .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(mockRecordFunnelEvent).not.toHaveBeenCalled();
    });

    test('preserves the canonical unsupported-event response', async () => {
        const response = await request(app)
            .post('/api/analytics/funnel')
            .send({ event: 'not_a_real_event' })
            .expect(400);

        expect(response.body.error.code).toBe('INVALID_FUNNEL_EVENT');
        expect(mockRecordFunnelEvent).not.toHaveBeenCalled();
    });

    test('passes a validated idempotency key into the service', async () => {
        const response = await request(app)
            .post('/api/analytics/funnel')
            .set('Idempotency-Key', 'funnel-retry-0001')
            .send({ event: 'signup_started', metadata: { source: 'landing' }, sessionId: 'session-1', path: '/' })
            .expect(200);

        expect(response.body.data.id).toBe('funnel-row-1');
        expect(response.headers['ratelimit-limit']).toBe('60');
        expect(mockRecordFunnelEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'signup_started',
            onceKey: 'funnel-retry-0001',
        }));
    });

    test('returns the endpoint-specific 429 response after the write budget is exhausted', async () => {
        let response;
        for (let attempt = 0; attempt < 61; attempt += 1) {
            response = await request(app)
                .post('/api/analytics/funnel')
                .send({ event: 'landing_view' });
            if (response.status === 429) break;
        }

        expect(response.status).toBe(429);
        expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
});
