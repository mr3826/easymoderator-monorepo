/**
 * Campaign API — Integration Tests
 * Tests HTTP endpoints via supertest with mocked DB and Redis
 */

// ── Environment ───────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

// ── Redis mocks ───────────────────────────────────────────────────────────────
jest.mock('src/config/redis', () => ({
    sessionRedis: null, cacheRedis: null, rateLimitRedis: null, legacyRedis: null,
    closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({}))
}));

const redisStore = {};
const mockRedis = {
    get: jest.fn((k) => Promise.resolve(redisStore[k] || null)),
    set: jest.fn((k, v) => { redisStore[k] = v; return Promise.resolve('OK'); }),
    setex: jest.fn((k, t, v) => { redisStore[k] = v; return Promise.resolve('OK'); }),
    del: jest.fn((k) => { delete redisStore[k]; return Promise.resolve(1); }),
    incr: jest.fn((k) => { redisStore[k] = (parseInt(redisStore[k], 10) || 0) + 1; return Promise.resolve(redisStore[k]); }),
    expire: jest.fn(() => Promise.resolve(1)),
    ttl: jest.fn(() => Promise.resolve(900)),
    status: 'ready'
};
jest.mock('src/utils/redis-client', () => ({
    getRedisClient: () => mockRedis, isRedisAvailable: () => true, closeRedis: jest.fn()
}));

// ── Sequelize mock ────────────────────────────────────────────────────────────
const mockModel = {
    findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn(() => Promise.resolve([])),
    findAndCountAll: jest.fn(() => Promise.resolve({ rows: [], count: 0 })),
    create: jest.fn(), update: jest.fn(), destroy: jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function () { return this; })
};
jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => ({ ...mockModel })),
        transaction: jest.fn(() => Promise.resolve({ commit: jest.fn(), rollback: jest.fn() })),
        authenticate: jest.fn(() => Promise.resolve()),
        sync: jest.fn(() => Promise.resolve()),
        literal: jest.fn((s) => s),
        query: jest.fn(() => Promise.resolve([[]])),
        getDialect: jest.fn(() => 'postgres')
    }
}));

// ── Queue manager mock ────────────────────────────────────────────────────────
jest.mock('src/jobs/queue-manager', () => ({
    queues: {
        campaignSend: {
            add: jest.fn().mockResolvedValue({ id: 'job-1' }),
            addBulk: jest.fn().mockResolvedValue([])
        },
        notifications: { add: jest.fn().mockResolvedValue({ id: 'notif-1' }) }
    }
}));

// ── Entities mock ─────────────────────────────────────────────────────────────
const mockCampaignData = {
    id: 'camp-1', shop_id: 'shop-1', name: 'Ramadan Win-Back',
    message_template: 'Hi! We miss you. Get 15% off.',
    status: 'draft', segment_filter: { requireConsent: true, recipientCap: 500 },
    sent_count: 0, failed_count: 0, total_recipients: 0,
    scheduled_at: null, created_at: new Date(), updated_at: new Date(),
    update: jest.fn(async function (data) { Object.assign(this, data); return this; }),
    toJSON: function () { return { ...this, update: undefined, toJSON: undefined }; }
};

jest.mock('src/modules/entities', () => ({
    User: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() },
    Shop: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    UserShop: { findOne: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    Campaign: {
        findOne: jest.fn(),
        findAll: jest.fn(() => Promise.resolve([mockCampaignData])),
        create: jest.fn(() => Promise.resolve(mockCampaignData)),
        findByPk: jest.fn(),
        increment: jest.fn()
    },
    Customer: { findAll: jest.fn(() => Promise.resolve([])) },
    Order: { findAll: jest.fn(() => Promise.resolve([])), sequelize: { fn: jest.fn(), col: jest.fn() } },
    Channel: { findOne: jest.fn() },
    // Stub remaining entities
    Product: { findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn() },
    OrderItem: { findAll: jest.fn() },
    OrderReturn: { findAll: jest.fn() },
    Invoice: { create: jest.fn() },
    PushSubscription: { create: jest.fn(), findOne: jest.fn(), destroy: jest.fn() }
}));

// ── Auth token ────────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const validToken = jwt.sign(
    { id: 'user-1', shopId: 'shop-1' },
    'test-access-secret',
    { expiresIn: '1h' }
);

const request = require('supertest');
const { Campaign, UserShop, Channel, Customer } = require('src/modules/entities');
const queueManager = require('src/jobs/queue-manager');

let app;
beforeAll(() => { app = require('src/app'); });

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(redisStore).forEach((k) => delete redisStore[k]);
    UserShop.findOne.mockResolvedValue({ id: 'us-1', role: 'owner', is_active: true });
    Campaign.findOne.mockResolvedValue({ ...mockCampaignData, update: jest.fn(async function (d) { Object.assign(this, d); return this; }) });
    Campaign.findAll.mockResolvedValue([mockCampaignData]);
    Campaign.create.mockResolvedValue(mockCampaignData);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Campaign API', () => {

    describe('GET /api/campaigns', () => {
        it('returns 200 with campaign list', async () => {
            const res = await request(app)
                .get('/api/campaigns')
                .set('Authorization', `Bearer ${validToken}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeInstanceOf(Array);
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app).get('/api/campaigns');
            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/campaigns', () => {
        const validPayload = {
            name: 'Test Campaign',
            message_template: 'Hello, we miss you!',
            segment_filter: { requireConsent: true, recipientCap: 100 }
        };

        it('creates campaign and returns 201', async () => {
            const res = await request(app)
                .post('/api/campaigns')
                .set('Authorization', `Bearer ${validToken}`)
                .send(validPayload);
            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(Campaign.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Campaign' }));
        });

        it('returns 400 when name is missing', async () => {
            const res = await request(app)
                .post('/api/campaigns')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ message_template: 'Hello!' });
            expect(res.status).toBe(400);
        });

        it('returns 400 when message_template is missing', async () => {
            const res = await request(app)
                .post('/api/campaigns')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ name: 'My Campaign' });
            expect(res.status).toBe(400);
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app).post('/api/campaigns').send(validPayload);
            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/campaigns/:id/run', () => {
        it('triggers campaign run and returns 200', async () => {
            Channel.findOne.mockResolvedValue({ page_id: 'page-1', access_token: 'token' });
            Customer.findAll.mockResolvedValue([]);
            const res = await request(app)
                .post('/api/campaigns/camp-1/run')
                .set('Authorization', `Bearer ${validToken}`);
            expect([200, 202]).toContain(res.status);
        });

        it('returns 404 when campaign not found', async () => {
            Campaign.findOne.mockResolvedValue(null);
            const res = await request(app)
                .post('/api/campaigns/nonexistent/run')
                .set('Authorization', `Bearer ${validToken}`);
            expect(res.status).toBe(404);
        });

        it('returns 400 when campaign already running', async () => {
            Campaign.findOne.mockResolvedValue({ ...mockCampaignData, status: 'running', update: jest.fn() });
            const res = await request(app)
                .post('/api/campaigns/camp-1/run')
                .set('Authorization', `Bearer ${validToken}`);
            expect(res.status).toBe(400);
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app).post('/api/campaigns/camp-1/run');
            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/campaigns/:id/schedule', () => {
        const futureDate = new Date(Date.now() + 3600000).toISOString();

        it('schedules campaign and returns 200', async () => {
            const res = await request(app)
                .post('/api/campaigns/camp-1/schedule')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ scheduledAt: futureDate });
            expect([200, 202]).toContain(res.status);
        });

        it('returns 400 when scheduledAt is missing', async () => {
            const res = await request(app)
                .post('/api/campaigns/camp-1/schedule')
                .set('Authorization', `Bearer ${validToken}`)
                .send({});
            expect(res.status).toBe(400);
        });

        it('returns 404 when campaign not found', async () => {
            Campaign.findOne.mockResolvedValue(null);
            const res = await request(app)
                .post('/api/campaigns/nonexistent/schedule')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ scheduledAt: futureDate });
            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/campaigns/:id/stats', () => {
        it('returns stats with all required fields', async () => {
            Campaign.findOne.mockResolvedValue({
                ...mockCampaignData, sent_count: 50, failed_count: 5, total_recipients: 100
            });
            const res = await request(app)
                .get('/api/campaigns/camp-1/stats')
                .set('Authorization', `Bearer ${validToken}`);
            expect([200]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.data).toMatchObject(expect.objectContaining({
                    sent_count: 50, failed_count: 5, total_recipients: 100
                }));
            }
        });

        it('returns 404 when campaign not found', async () => {
            Campaign.findOne.mockResolvedValue(null);
            const res = await request(app)
                .get('/api/campaigns/nonexistent/stats')
                .set('Authorization', `Bearer ${validToken}`);
            expect(res.status).toBe(404);
        });
    });
});
