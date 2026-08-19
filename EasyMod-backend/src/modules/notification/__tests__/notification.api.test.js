/**
 * Notification API — Integration Tests
 * Tests POST /api/notifications/push and POST /api/notifications/mark-handoff via Supertest
 */

'use strict';

// ── In-memory Redis ───────────────────────────────────────────────────────────
const redisStore = {};
jest.mock('../../../utils/redis-client', () => ({
    get: jest.fn(async (k) => redisStore[k] ?? null),
    set: jest.fn(async (k, v) => { redisStore[k] = v; }),
    del: jest.fn(async (k) => { delete redisStore[k]; }),
    setex: jest.fn(async (k, _ttl, v) => { redisStore[k] = v; }),
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
}));

// ── Entity mocks ──────────────────────────────────────────────────────────────
let mockConversation = null;
jest.mock('../../entities', () => {
    const mockConvInstance = {
        id: 'conv-1', shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', customer_id: 'cust-1', channel: 'messenger',
        metadata: {},
        update: jest.fn().mockResolvedValue(true),
        status: 'open',
    };
    return {
        Conversation: {
            findOne: jest.fn(async () => mockConvInstance),
        },
        Message: {
            create: jest.fn().mockResolvedValue({ id: 'msg-sys-1' }),
        },
        PushSubscription: {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'sub-1' }),
            destroy: jest.fn().mockResolvedValue(1),
        },
        Shop: { findByPk: jest.fn().mockResolvedValue({ id: 'shop-1', name: 'Test Shop', toJSON: () => ({ id: 'shop-1' }) }) },
        UserShop: { findOne: jest.fn().mockResolvedValue({ shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', role: 'owner' }) },
    };
});

// The controller imports Conversation/Message from conversation.entity, not
// from the entities barrel. Mocking only the barrel left it using the real
// entity built on the stubbed sequelize.define, whose findOne returns
// undefined — so every handoff answered 404.
const mockConvUpdate = jest.fn().mockResolvedValue(true);
const mockConversationRow = () => ({
    id: 'conv-1',
    shop_id: 'cccccccc-3333-4333-8333-cccccccccccc',
    customer_id: 'cust-1',
    channel: 'messenger',
    metadata: {},
    update: mockConvUpdate,
});
jest.mock('../../conversation/conversation.entity', () => ({
    Conversation: { findOne: jest.fn() },
    Message: { create: jest.fn() },
}));

// ── Queue mock ────────────────────────────────────────────────────────────────
const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-notif-1' });
jest.mock('../../../jobs/queue-manager', () => ({
    queues: {
        notifications: { add: mockQueueAdd }
    }
}));

// ── Shop service mock ─────────────────────────────────────────────────────────
jest.mock('../../shop/shop.service', () => ({
    getShopById: jest.fn().mockResolvedValue({ id: 'shop-1', name: 'Test Shop' }),
}));

// ── Auth middleware mock ──────────────────────────────────────────────────────
jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: (req, _res, next) => {
        // The real middleware sets req.user; the controller reads
        // req.user?.shopId and 403s on a flat req.shopId.
        req.user = { userId: 'user-1', shopId: 'cccccccc-3333-4333-8333-cccccccccccc' };
        next();
    }
}));

// `define` is not optional: entity modules reached through the router call it
// at IMPORT time (conversation.entity.js is the one this suite pulls in), so a
// stub without it throws before the first request is ever made.
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => ({
            findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn(() => Promise.resolve([])),
            findAndCountAll: jest.fn(() => Promise.resolve({ rows: [], count: 0 })),
            create: jest.fn(), update: jest.fn(), destroy: jest.fn(), count: jest.fn(),
            belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
            addScope: jest.fn(), scope: jest.fn(function () { return this; })
        })),
        transaction: jest.fn(async (cb) => {
            const t = { commit: jest.fn(), rollback: jest.fn() };
            if (typeof cb === 'function') return cb(t);
            return t;
        }),
        authenticate: jest.fn(() => Promise.resolve()),
        sync: jest.fn(() => Promise.resolve()),
        literal: jest.fn((s) => s),
        query: jest.fn(() => Promise.resolve([[]])),
        getDialect: jest.fn(() => 'postgres')
    }
}));

const request = require('supertest');
const express = require('express');

let app;
beforeAll(() => {
    app = express();
    app.use(express.json());
    // Mount notification routes
    const notifRoutes = require('../notification.routes');
    app.use('/api/notifications', notifRoutes);
});

beforeEach(() => {
    jest.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: 'job-notif-1' });
    const { Conversation, Message } = require('../../conversation/conversation.entity');
    mockConvUpdate.mockResolvedValue(true);
    Conversation.findOne.mockResolvedValue(mockConversationRow());
    Message.create.mockResolvedValue({ id: 'msg-sys-1' });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/notifications/push', () => {
    it('queues a push notification and returns 200 with notification_id', async () => {
        const res = await request(app)
            .post('/api/notifications/push')
            .send({ shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', type: 'new_order', title: 'New Order!', body: 'You have a new order', data: { orderId: 'ord-1' } });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.notification_id).toBeDefined();
        expect(mockQueueAdd).toHaveBeenCalled();
    });

    it('enqueues job with correct shopId and payload', async () => {
        await request(app)
            .post('/api/notifications/push')
            .send({ shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', type: 'payment', title: 'Payment Received', body: 'BDT 500 received', data: {} });

        // The job NAME is part of the contract — the worker routes on it.
        expect(mockQueueAdd).toHaveBeenCalledWith(
            'push-notification',
            expect.objectContaining({
                shopId: 'cccccccc-3333-4333-8333-cccccccccccc',
                payload: expect.objectContaining({ title: 'Payment Received', body: 'BDT 500 received' })
            })
        );
    });

    it('returns 400 when title is missing', async () => {
        const res = await request(app)
            .post('/api/notifications/push')
            .send({ shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', body: 'Missing title' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('returns 400 when body is missing', async () => {
        const res = await request(app)
            .post('/api/notifications/push')
            .send({ shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', title: 'Missing body' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    // shop_id is OPTIONAL on this route — it defaults to the caller's own shop,
    // which is the safe direction. What is required is `type`, and this payload
    // omits it; the previous name claimed shop_id was being enforced, so the
    // test passed while asserting the opposite of the real rule.
    it('returns 400 when type is missing', async () => {
        const res = await request(app)
            .post('/api/notifications/push')
            .send({ title: 'No type', body: 'No type field' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('defaults shop_id to the caller own shop when omitted', async () => {
        const res = await request(app)
            .post('/api/notifications/push')
            .send({ type: 'new_order', title: 'T', body: 'B' });

        expect(res.status).toBe(200);
        expect(mockQueueAdd).toHaveBeenCalledWith(
            'push-notification',
            expect.objectContaining({ shopId: 'cccccccc-3333-4333-8333-cccccccccccc' })
        );
    });

    it('still returns 200 with fallback notification_id when queue is null', async () => {
        // Temporarily make queue.add unavailable
        const qm = require('../../../jobs/queue-manager');
        const originalQueue = qm.queues.notifications;
        qm.queues.notifications = null;

        const res = await request(app)
            .post('/api/notifications/push')
            .send({ shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', type: 'new_order', title: 'Test', body: 'Test body' });

        qm.queues.notifications = originalQueue;

        expect(res.status).toBe(200);
        expect(res.body.notification_id).toContain('notif_');
    });
});

describe('POST /api/notifications/mark-handoff', () => {
    it('marks conversation for handoff and returns 200', async () => {
        const res = await request(app)
            .post('/api/notifications/mark-handoff')
            .send({
                shop_id: 'cccccccc-3333-4333-8333-cccccccccccc',
                customer_id: 'cust-1',
                platform: 'messenger',
                trigger_reason: 'customer_requested',
                confidence_score: 45,
                last_message: 'I need help'
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 404 when conversation not found', async () => {
        const { Conversation } = require('../../conversation/conversation.entity');
        Conversation.findOne.mockResolvedValueOnce(null);

        const res = await request(app)
            .post('/api/notifications/mark-handoff')
            .send({
                shop_id: 'cccccccc-3333-4333-8333-cccccccccccc',
                customer_id: 'cust-missing',
                platform: 'messenger',
                trigger_reason: 'test',
                confidence_score: 30,
                last_message: 'hi'
            });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it('creates a SYSTEM message in the conversation', async () => {
        const { Message } = require('../../conversation/conversation.entity');
        await request(app)
            .post('/api/notifications/mark-handoff')
            .send({
                shop_id: 'cccccccc-3333-4333-8333-cccccccccccc',
                customer_id: 'cust-1',
                platform: 'messenger',
                trigger_reason: 'low_confidence',
                confidence_score: 30,
                last_message: 'What is price?'
            });

        expect(Message.create).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('SYSTEM') })
        );
    });

    it('stores handoff metadata on the conversation', async () => {
        const { Conversation } = require('../../conversation/conversation.entity');
        const mockConv = {
            id: 'conv-1', shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', customer_id: 'cust-1', channel: 'messenger',
            metadata: {},
            update: jest.fn().mockResolvedValue(true),
        };
        Conversation.findOne.mockResolvedValueOnce(mockConv);

        await request(app)
            .post('/api/notifications/mark-handoff')
            .send({
                shop_id: 'cccccccc-3333-4333-8333-cccccccccccc', customer_id: 'cust-1', platform: 'messenger',
                trigger_reason: 'complex_query', confidence_score: 25, last_message: 'Help!'
            });

        expect(mockConv.update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'NEEDS_HUMAN',
                metadata: expect.objectContaining({
                    handoff_info: expect.objectContaining({ trigger_reason: 'complex_query' })
                })
            })
        );
    });
});
