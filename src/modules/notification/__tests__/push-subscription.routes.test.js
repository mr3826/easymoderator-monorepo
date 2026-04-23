/**
 * Push Subscription Routes — Unit Tests
 * Tests POST /api/notifications/subscriptions and DELETE /api/notifications/subscriptions/:id
 */

'use strict';

// ── In-memory Redis mock ──────────────────────────────────────────────────────
const redisStore = {};
jest.mock('../../../utils/redis', () => ({
    get: jest.fn(async (k) => redisStore[k] ?? null),
    set: jest.fn(async (k, v) => { redisStore[k] = v; }),
    del: jest.fn(async (k) => { delete redisStore[k]; }),
    setex: jest.fn(async (k, _ttl, v) => { redisStore[k] = v; }),
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })
}));

// ── PushSubscription entity mock ──────────────────────────────────────────────
let mockSubRow = null;
jest.mock('../../entities', () => ({
    PushSubscription: {
        findOne: jest.fn(async () => mockSubRow),
        create: jest.fn(async (data) => ({ id: 'sub-uuid-1', ...data })),
        destroy: jest.fn(async () => 1),
    }
}));

// ── Auth middleware mock ──────────────────────────────────────────────────────
jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: (req, _res, next) => {
        req.userId = 'user-1';
        req.shopId = 'shop-1';
        next();
    }
}));

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (cb) => {
            const t = { commit: jest.fn(), rollback: jest.fn() };
            if (typeof cb === 'function') return cb(t);
            return t;
        })
    }
}));

const request = require('supertest');
const express = require('express');

let app;
beforeAll(() => {
    app = express();
    app.use(express.json());
    const notifRouter = require('../push-subscription.routes');
    app.use('/api/notifications', notifRouter);
});

beforeEach(() => {
    jest.clearAllMocks();
    mockSubRow = null;
    const { PushSubscription } = require('../../entities');
    PushSubscription.create.mockResolvedValue({ id: 'sub-uuid-1', shop_id: 'shop-1', type: 'web', subscription_json: null, device_token: null });
    PushSubscription.destroy.mockResolvedValue(1);
});

// ── POST /subscriptions ───────────────────────────────────────────────────────

describe('POST /api/notifications/subscriptions', () => {
    it('registers a web push subscription and returns 201', async () => {
        const subJson = { endpoint: 'https://fcm.googleapis.com/test', keys: { p256dh: 'pk', auth: 'ak' } };
        const res = await request(app)
            .post('/api/notifications/subscriptions')
            .send({ type: 'web', subscription_json: subJson });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.id).toBeDefined();
    });

    it('registers an FCM device token and returns 201', async () => {
        const res = await request(app)
            .post('/api/notifications/subscriptions')
            .send({ type: 'fcm', device_token: 'fcm-device-token-abc' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.id).toBeDefined();
    });

    it('returns 400 when type is invalid', async () => {
        const res = await request(app)
            .post('/api/notifications/subscriptions')
            .send({ type: 'invalid' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('returns 400 when web type is missing subscription_json', async () => {
        const res = await request(app)
            .post('/api/notifications/subscriptions')
            .send({ type: 'web' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('returns 400 when fcm type is missing device_token', async () => {
        const res = await request(app)
            .post('/api/notifications/subscriptions')
            .send({ type: 'fcm' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('upserts FCM token if existing subscription found', async () => {
        const existingMock = { id: 'sub-existing', update: jest.fn().mockResolvedValue(true) };
        mockSubRow = existingMock;
        const { PushSubscription } = require('../../entities');
        PushSubscription.findOne.mockResolvedValue(existingMock);

        const res = await request(app)
            .post('/api/notifications/subscriptions')
            .send({ type: 'fcm', device_token: 'new-fcm-token' });

        expect(res.status).toBe(201);
        expect(existingMock.update).toHaveBeenCalled();
    });

    it('returns 500 when DB throws', async () => {
        const { PushSubscription } = require('../../entities');
        PushSubscription.create.mockRejectedValueOnce(new Error('DB error'));
        PushSubscription.findOne.mockResolvedValueOnce(null);

        const res = await request(app)
            .post('/api/notifications/subscriptions')
            .send({ type: 'fcm', device_token: 'some-token' });

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});

// ── DELETE /subscriptions/:id ─────────────────────────────────────────────────

describe('DELETE /api/notifications/subscriptions/:id', () => {
    it('deletes a subscription and returns 200', async () => {
        const validUUID = '550e8400-e29b-41d4-a716-446655440000';
        const res = await request(app)
            .delete(`/api/notifications/subscriptions/${validUUID}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 404 when subscription not found', async () => {
        const { PushSubscription } = require('../../entities');
        PushSubscription.destroy.mockResolvedValueOnce(0);

        const validUUID = '550e8400-e29b-41d4-a716-446655440001';
        const res = await request(app)
            .delete(`/api/notifications/subscriptions/${validUUID}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it('returns 400 when id is not a valid UUID', async () => {
        const res = await request(app)
            .delete('/api/notifications/subscriptions/not-a-uuid');

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('returns 500 when DB throws on delete', async () => {
        const { PushSubscription } = require('../../entities');
        PushSubscription.destroy.mockRejectedValueOnce(new Error('DB error'));

        const validUUID = '550e8400-e29b-41d4-a716-446655440002';
        const res = await request(app)
            .delete(`/api/notifications/subscriptions/${validUUID}`);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });

    it('scopes delete to shop_id from auth token', async () => {
        const { PushSubscription } = require('../../entities');
        const validUUID = '550e8400-e29b-41d4-a716-446655440003';
        await request(app).delete(`/api/notifications/subscriptions/${validUUID}`);

        expect(PushSubscription.destroy).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ shop_id: 'shop-1' })
            })
        );
    });
});
