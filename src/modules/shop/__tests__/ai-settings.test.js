const request = require('supertest');

// ── Env vars ───────────────────────────────────────────────────────────────
process.env.NODE_ENV           = 'test';
process.env.JWT_ACCESS_SECRET  = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

// ── Mock Redis ─────────────────────────────────────────────────────────────
const redisStore = {};
const mockRedis = {
    get:    jest.fn((k)         => Promise.resolve(redisStore[k] || null)),
    set:    jest.fn((k, v)      => { redisStore[k] = v; return Promise.resolve('OK'); }),
    setex:  jest.fn((k, ttl, v) => { redisStore[k] = v; return Promise.resolve('OK'); }),
    del:    jest.fn((k)         => { delete redisStore[k]; return Promise.resolve(1); }),
    incr:   jest.fn((k)         => { redisStore[k] = (parseInt(redisStore[k], 10) || 0) + 1; return Promise.resolve(redisStore[k]); }),
    expire: jest.fn(()          => Promise.resolve(1)),
    ttl:    jest.fn(()          => Promise.resolve(900)),
    status: 'ready'
};
jest.mock('src/utils/redis-client', () => ({
    getRedisClient:   () => mockRedis,
    isRedisAvailable: () => true,
    closeRedis:       jest.fn()
}));

// ── Mock Sequelize ─────────────────────────────────────────────────────────
const mockModel = {
    findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn(() => Promise.resolve([])),
    create: jest.fn(), update: jest.fn(), destroy: jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
};
jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define:       jest.fn(() => ({ ...mockModel })),
        transaction:  jest.fn(() => Promise.resolve({ commit: jest.fn(), rollback: jest.fn() })),
        authenticate: jest.fn(() => Promise.resolve()),
        sync:         jest.fn(() => Promise.resolve()),
    },
    Op: {}
}));

// ── Mock entities ─────────────────────────────────────────────────────────
const mockShop = {
    id: 'shop-1',
    shop_name: 'Test Shop',
    settings: { ai: { automation_mode: 'DRAFT', confidence_threshold: 60 } },
    update: jest.fn(function(data) {
        Object.assign(this, data);
        return Promise.resolve(this);
    }),
    toJSON: function() { return { ...this, update: undefined, toJSON: undefined }; }
};
const mockUserShop = { user_id: 'user-1', shop_id: 'shop-1', is_active: true, role: 'owner', shop: mockShop };

jest.mock('src/modules/entities', () => ({
    Shop:    { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() },
    UserShop:{ findOne: jest.fn(), findAll: jest.fn(() => Promise.resolve([])), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    User:    { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() },
    Tenant:  { ...mockModel },
    FaqResponse: { ...mockModel }, BanglishDictionary: { ...mockModel }, MetaIntegration: { ...mockModel },
    Order: { ...mockModel }, OrderItem: { ...mockModel }, Product: { ...mockModel },
    Category: { ...mockModel }, Customer: { ...mockModel }, Channel: { ...mockModel },
    Conversation: { ...mockModel }, Message: { ...mockModel }, Keyword: { ...mockModel },
    AuditLog: { ...mockModel }, IdempotencyKey: { ...mockModel }, Subscription: { ...mockModel },
    Invoice: { ...mockModel }, UsageEvent: { ...mockModel }, PaymentConfig: { ...mockModel },
    DeliveryIntegration: { ...mockModel }, DeliveryCost: { ...mockModel }, KnownArea: { ...mockModel },
    Analytics: { ...mockModel }, OrderReturn: { ...mockModel }, SupportTicket: { ...mockModel },
}));
jest.mock('src/modules/analytics/knowledge-gap.entity', () => ({
    findAll: jest.fn(() => Promise.resolve([])), create: jest.fn(), findOne: jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(),
}));
jest.mock('src/modules/rag/rag.service',  () => ({ ingestData: jest.fn(() => Promise.resolve()) }));
jest.mock('src/utils/cache.service',      () => ({ getForShop: jest.fn(() => Promise.resolve(null)), setForShop: jest.fn(), deleteForShop: jest.fn() }));
jest.mock('src/middleware/session.middleware', () => () => (req, res, next) => next());
jest.mock('src/utils/workflow-client',    () => ({ postToWorkflow: jest.fn(() => Promise.resolve({})) }));

// ── Inject authenticated user ──────────────────────────────────────────────
jest.mock('src/middleware/auth.middleware', () => ({
    authenticate:            (req, res, next) => { req.user = { userId: 'user-1', shopId: 'shop-1', role: 'owner' }; next(); },
    checkSubscriptionStatus: (req, res, next) => next(),
}));

const { Shop, UserShop } = require('src/modules/entities');

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Shop AI Settings API', () => {
    let app;

    beforeAll(() => {
        app = require('src/app');
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockShop.update.mockClear();
        mockShop.settings = { ai: { automation_mode: 'DRAFT', confidence_threshold: 60 } };

        Shop.findByPk.mockResolvedValue(mockShop);
        UserShop.findOne.mockResolvedValue({ ...mockUserShop, shop: { ...mockShop, toJSON: () => ({ id: 'shop-1' }) } });
    });

    // ── GET /shop/ai-settings ─────────────────────────────────────────────

    describe('GET /shop/ai-settings', () => {
        it('returns 200 with ai settings', async () => {
            const res = await request(app).get('/api/shop/ai-settings');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('automation_mode');
        });

        it('returns settings with defaults for unset fields', async () => {
            mockShop.settings = {}; // no ai key
            Shop.findByPk.mockResolvedValue(mockShop);

            const res = await request(app).get('/api/shop/ai-settings');

            expect(res.status).toBe(200);
            const data = res.body.data;
            expect(data.automation_mode).toBe('DRAFT');
            expect(data.confidence_threshold).toBe(60);
            expect(data.required_fields).toHaveProperty('customer_name');
        });

        it('merges stored values over defaults', async () => {
            mockShop.settings = { ai: { automation_mode: 'AUTO', confidence_threshold: 85 } };
            Shop.findByPk.mockResolvedValue(mockShop);

            const res = await request(app).get('/api/shop/ai-settings');

            expect(res.body.data.automation_mode).toBe('AUTO');
            expect(res.body.data.confidence_threshold).toBe(85);
        });
    });

    // ── PUT /shop/ai-settings ─────────────────────────────────────────────

    describe('PUT /shop/ai-settings', () => {
        it('accepts valid automation_mode', async () => {
            for (const mode of ['DRAFT', 'AUTO', 'MANUAL']) {
                const res = await request(app)
                    .put('/api/shop/ai-settings')
                    .send({ automation_mode: mode });
                expect(res.status).toBe(200);
            }
        });

        it('rejects invalid automation_mode', async () => {
            const res = await request(app)
                .put('/api/shop/ai-settings')
                .send({ automation_mode: 'ROGUE' });

            expect(res.status).toBe(400);
        });

        it('accepts confidence_threshold between 0 and 100', async () => {
            const res = await request(app)
                .put('/api/shop/ai-settings')
                .send({ confidence_threshold: 75 });

            expect(res.status).toBe(200);
        });

        it('rejects confidence_threshold above 100', async () => {
            const res = await request(app)
                .put('/api/shop/ai-settings')
                .send({ confidence_threshold: 101 });

            expect(res.status).toBe(400);
        });

        it('rejects negative confidence_threshold', async () => {
            const res = await request(app)
                .put('/api/shop/ai-settings')
                .send({ confidence_threshold: -1 });

            expect(res.status).toBe(400);
        });

        it('accepts valid primary_language values', async () => {
            for (const lang of ['mixed', 'en', 'bn']) {
                const res = await request(app)
                    .put('/api/shop/ai-settings')
                    .send({ primary_language: lang });
                expect(res.status).toBe(200);
            }
        });

        it('rejects unknown primary_language', async () => {
            const res = await request(app)
                .put('/api/shop/ai-settings')
                .send({ primary_language: 'fr' });
            expect(res.status).toBe(400);
        });

        it('rejects invalid notification_channel in handoff_settings', async () => {
            const res = await request(app)
                .put('/api/shop/ai-settings')
                .send({ handoff_settings: { notification_channel: 'telegram' } });
            expect(res.status).toBe(400);
        });

        it('accepts valid notification_channel', async () => {
            const res = await request(app)
                .put('/api/shop/ai-settings')
                .send({ handoff_settings: { notification_channel: 'in_app', cooldown_minutes: 30 } });
            expect(res.status).toBe(200);
        });

        it('converts auto_reply_enabled to boolean', async () => {
            const res = await request(app)
                .put('/api/shop/ai-settings')
                .send({ auto_reply_enabled: 'true' }); // string input
            expect(res.status).toBe(200);
        });
    });

    // ── updateShopAiSettings service — deep-merge ─────────────────────────

    describe('updateShopAiSettings service (deep-merge)', () => {
        it('deep-merges required_fields without overwriting other keys', async () => {
            const shopService = require('src/modules/shop/shop.service');
            const shopWithSettings = {
                ...mockShop,
                settings: {
                    ai: {
                        required_fields: { customer_name: true, mobile_number: true, delivery_address: true, payment_method: true, email_address: false, special_instructions: false }
                    }
                },
                update: jest.fn(() => Promise.resolve())
            };
            Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

            await shopService.updateShopAiSettings('shop-1', 'user-1', {
                required_fields: { email_address: true }
            });

            const updateCall = shopWithSettings.update.mock.calls[0][0];
            const saved = updateCall.settings.ai.required_fields;

            // email_address was updated
            expect(saved.email_address).toBe(true);
            // Other required fields must be preserved
            expect(saved.customer_name).toBe(true);
            expect(saved.mobile_number).toBe(true);
            expect(saved.delivery_address).toBe(true);
        });

        it('deep-merges handoff_settings without overwriting other keys', async () => {
            const shopService = require('src/modules/shop/shop.service');
            const shopWithSettings = {
                ...mockShop,
                settings: {
                    ai: {
                        handoff_settings: { trigger_keywords: ['complain'], notification_channel: 'in_app', cooldown_minutes: 30 }
                    }
                },
                update: jest.fn(() => Promise.resolve())
            };
            Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

            await shopService.updateShopAiSettings('shop-1', 'user-1', {
                handoff_settings: { cooldown_minutes: 60 }
            });

            const updateCall = shopWithSettings.update.mock.calls[0][0];
            const saved = updateCall.settings.ai.handoff_settings;

            expect(saved.cooldown_minutes).toBe(60);          // updated
            expect(saved.trigger_keywords).toEqual(['complain']); // preserved
            expect(saved.notification_channel).toBe('in_app'); // preserved
        });

        it('does not touch other settings keys when updating ai', async () => {
            const shopService = require('src/modules/shop/shop.service');
            const shopWithSettings = {
                ...mockShop,
                settings: {
                    businessInfo: { shopName: 'My Shop' },
                    ai: { automation_mode: 'DRAFT' }
                },
                update: jest.fn(() => Promise.resolve())
            };
            Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

            await shopService.updateShopAiSettings('shop-1', 'user-1', { automation_mode: 'AUTO' });

            const updateCall = shopWithSettings.update.mock.calls[0][0];
            // businessInfo must be preserved at the top level
            expect(updateCall.settings.businessInfo).toEqual({ shopName: 'My Shop' });
        });
    });
});
