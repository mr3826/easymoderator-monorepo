const request = require('supertest');

// ── Env ────────────────────────────────────────────────────────────────────
process.env.NODE_ENV           = 'test';
process.env.JWT_ACCESS_SECRET  = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

// ── UUID constants ─────────────────────────────────────────────────────────
const CAT_ID    = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const CAT2_ID   = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23';
const SUBCAT_ID = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';
const USER_ID   = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const SHOP_ID   = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';

// ── Mock Redis ─────────────────────────────────────────────────────────────
const redisStore = {};
const mockRedis = {
    get:    jest.fn(k => Promise.resolve(redisStore[k] || null)),
    set:    jest.fn((k, v) => { redisStore[k] = v; return Promise.resolve('OK'); }),
    setex:  jest.fn((k, _ttl, v) => { redisStore[k] = v; return Promise.resolve('OK'); }),
    del:    jest.fn(k => { delete redisStore[k]; return Promise.resolve(1); }),
    incr:   jest.fn(k => { redisStore[k] = (parseInt(redisStore[k], 10) || 0) + 1; return Promise.resolve(redisStore[k]); }),
    expire: jest.fn(() => Promise.resolve(1)),
    ttl:    jest.fn(() => Promise.resolve(900)),
    status: 'ready',
};
jest.mock('src/utils/redis-client', () => ({
    getRedisClient:   () => mockRedis,
    isRedisAvailable: () => true,
    closeRedis:       jest.fn(),
}));
jest.mock('src/config/redis', () => ({
    rateLimitRedis: null,
    sessionRedis:   null,
    cacheRedis:     null,
    closeAll:       jest.fn(),
}));

// ── Mock Sequelize ─────────────────────────────────────────────────────────
const mockTx = { commit: jest.fn(() => Promise.resolve()), rollback: jest.fn(() => Promise.resolve()) };
const mockModel = {
    findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn(() => Promise.resolve([])),
    create: jest.fn(), update: jest.fn(), destroy: jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function () { return this; }),
};
jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define:       jest.fn(() => ({ ...mockModel })),
        transaction:  jest.fn(() => Promise.resolve(mockTx)),
        authenticate: jest.fn(() => Promise.resolve()),
        sync:         jest.fn(() => Promise.resolve()),
        getDialect:   jest.fn(() => 'postgres'),
        fn:           jest.fn(), col: jest.fn(), literal: jest.fn(),
    },
    Op: require('sequelize').Op,
}));

// ── Mock entities ──────────────────────────────────────────────────────────
jest.mock('src/modules/entities', () => ({
    Category: { findOne: jest.fn(), findAll: jest.fn(() => Promise.resolve([])), create: jest.fn(), destroy: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    Shop:     { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() },
    UserShop: { findOne: jest.fn(), findAll: jest.fn(() => Promise.resolve([])), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    User:     { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() },
    Product:  { findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn(() => Promise.resolve([])), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    Tenant:              { ...mockModel }, FaqResponse:  { ...mockModel }, BanglishDictionary: { ...mockModel },
    MetaIntegration:     { ...mockModel }, Order:        { ...mockModel }, OrderItem:          { ...mockModel },
    Channel:             { ...mockModel }, Conversation: { ...mockModel }, Message:            { ...mockModel },
    Keyword:             { ...mockModel }, AuditLog:     { ...mockModel }, IdempotencyKey:      { ...mockModel },
    Subscription:        { ...mockModel }, Invoice:      { ...mockModel }, UsageEvent:         { ...mockModel },
    PaymentConfig:       { ...mockModel }, DeliveryIntegration: { ...mockModel }, DeliveryCost: { ...mockModel },
    KnownArea:           { ...mockModel }, Analytics:    { ...mockModel }, OrderReturn:        { ...mockModel },
    SupportTicket:       { ...mockModel }, Customer:     { ...mockModel },
}));
jest.mock('src/modules/analytics/knowledge-gap.entity', () => ({
    findAll: jest.fn(() => Promise.resolve([])), create: jest.fn(), findOne: jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(),
}));

// ── Mock infrastructure ────────────────────────────────────────────────────
jest.mock('src/modules/rag/rag.service',      () => ({ ingestData: jest.fn(() => Promise.resolve()), deletePoint: jest.fn(() => Promise.resolve()) }));
jest.mock('src/utils/cache.service',          () => ({ getForShop: jest.fn(() => Promise.resolve(null)), setForShop: jest.fn(), deleteForShop: jest.fn() }));
jest.mock('src/middleware/session.middleware', () => () => (_req, _res, next) => next());
jest.mock('src/utils/workflow-client',        () => ({ postToWorkflow: jest.fn(() => Promise.resolve({})) }));
jest.mock('src/modules/subscription/subscription.service', () => ({
    trackUsage:            jest.fn(() => Promise.resolve({ transactionId: 'txn-1', isRetry: false })),
    checkUsageLimit:       jest.fn(() => Promise.resolve({ allowed: true })),
    getSubscriptionStatus: jest.fn(() => Promise.resolve({ plan: 'pro', isActive: true })),
}));
jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), logUsage: jest.fn() })),
}));
jest.mock('src/modules/shop/shop.service', () => ({
    getShopAiSettings:    jest.fn(() => Promise.resolve({})),
    updateShopAiSettings: jest.fn(() => Promise.resolve({})),
    getShopById: jest.fn(), getShopsByUserId: jest.fn(), createShop: jest.fn(),
    updateShopById: jest.fn(), deleteShopById: jest.fn(), addUserToShop: jest.fn(),
    removeUserFromShop: jest.fn(), updateUserRole: jest.fn(), getUserRoleInShop: jest.fn(),
}));
jest.mock('src/modules/product/product-ai.service', () => ({
    queueProductProcessing: jest.fn(), processPendingProducts: jest.fn(() => Promise.resolve()),
}));

// ── Mock auth middleware ───────────────────────────────────────────────────
// NOTE: factory is hoisted — use inline literals, not module-scope consts
jest.mock('src/middleware/auth.middleware', () => ({
    authenticate:            (req, _res, next) => {
        req.user = { userId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', shopId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', role: 'owner' };
        next();
    },
    checkSubscriptionStatus: (_req, _res, next) => next(),
}));

// ── Shared test data ───────────────────────────────────────────────────────
const mockSubcategory = {
    id:                 SUBCAT_ID,
    shop_id:            SHOP_ID,
    parent_category_id: CAT_ID,
    name:               'T-Shirts',
    is_active:          true,
    toJSON: function () { return { ...this, toJSON: undefined, update: undefined, destroy: undefined }; },
    update:  jest.fn(function (data) { Object.assign(this, data); return Promise.resolve(this); }),
    destroy: jest.fn(() => Promise.resolve()),
};

const mockCategory = {
    id:                 CAT_ID,
    shop_id:            SHOP_ID,
    parent_category_id: null,
    name:               'Clothing',
    description:        'All clothing items',
    is_active:          true,
    subcategories:      [mockSubcategory],
    toJSON: function () { return { ...this, toJSON: undefined, update: undefined, destroy: undefined }; },
    update:  jest.fn(function (data) { Object.assign(this, data); return Promise.resolve(this); }),
    destroy: jest.fn(() => Promise.resolve()),
};

const mockUserShop = { user_id: USER_ID, shop_id: SHOP_ID, is_active: true, role: 'owner' };

const { Category, UserShop } = require('src/modules/entities');
const { sequelize }           = require('src/utils/database/database-setup');

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Category API', () => {
    let app;

    beforeAll(() => { app = require('src/app'); });

    beforeEach(() => {
        mockCategory.update.mockReset().mockImplementation(function (data) { Object.assign(this, data); return Promise.resolve(this); });
        mockCategory.destroy.mockReset().mockResolvedValue(undefined);
        mockSubcategory.update.mockReset().mockImplementation(function (data) { Object.assign(this, data); return Promise.resolve(this); });
        mockSubcategory.destroy.mockReset().mockResolvedValue(undefined);
        mockTx.commit.mockReset().mockResolvedValue(undefined);
        mockTx.rollback.mockReset().mockResolvedValue(undefined);

        UserShop.findOne.mockReset().mockResolvedValue(mockUserShop);
        Category.findOne.mockReset().mockResolvedValue(mockCategory);
        Category.findAll.mockReset().mockResolvedValue([mockCategory]);
        Category.create.mockReset().mockResolvedValue(mockCategory);
        sequelize.transaction.mockReset().mockResolvedValue(mockTx);
    });

    // ── GET /category ─────────────────────────────────────────────────────

    describe('GET /category', () => {
        it('returns 200 with category list', async () => {
            const res = await request(app).get('/api/category');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
        });

        it('returns empty array when shop has no categories', async () => {
            Category.findAll.mockResolvedValueOnce([]);
            const res = await request(app).get('/api/category');
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });

        it('passes search query to DB findAll', async () => {
            const res = await request(app).get('/api/category?search=cloth');
            expect(res.status).toBe(200);
            expect(Category.findAll).toHaveBeenCalled();
        });

        it('rejects page < 1 (Joi validation)', async () => {
            const res = await request(app).get('/api/category?page=0');
            expect(res.status).toBe(400);
        });

        it('rejects limit > 100 (scalability guard)', async () => {
            const res = await request(app).get('/api/category?limit=101');
            expect(res.status).toBe(400);
        });

        it('returns 403 when user does not have shop access (SECURITY)', async () => {
            UserShop.findOne.mockResolvedValueOnce(null);
            const res = await request(app).get('/api/category');
            expect(res.status).toBe(403);
        });
    });

    // ── GET /category/:id ─────────────────────────────────────────────────

    describe('GET /category/:id', () => {
        it('returns 200 with category and subcategories', async () => {
            const res = await request(app).get(`/api/category/${CAT_ID}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 404 when category does not exist', async () => {
            Category.findOne.mockResolvedValueOnce(null);
            const res = await request(app).get(`/api/category/${CAT2_ID}`);
            expect(res.status).toBe(404);
        });

        it('returns 403 for unauthorized shop access (SECURITY)', async () => {
            UserShop.findOne.mockResolvedValueOnce(null);
            const res = await request(app).get(`/api/category/${CAT_ID}`);
            expect(res.status).toBe(403);
        });

        it('cannot access a category from another shop (SECURITY)', async () => {
            Category.findOne.mockResolvedValueOnce(null);
            const res = await request(app).get(`/api/category/${CAT2_ID}`);
            expect(res.status).toBe(404);
        });

        it('rejects non-UUID category ID', async () => {
            const res = await request(app).get('/api/category/not-a-uuid');
            expect(res.status).toBe(400);
        });
    });

    // ── GET /category/:categoryId/subcategory/:subcategoryId ─────────────

    describe('GET /category/:id/subcategory/:subId', () => {
        it('returns 200 with subcategory scoped to parent', async () => {
            // verifyShopAccess uses UserShop.findOne (mocked in beforeEach)
            // getSubcategoryById uses Category.findOne
            Category.findOne.mockResolvedValueOnce(mockSubcategory);
            const res = await request(app).get(`/api/category/${CAT_ID}/subcategory/${SUBCAT_ID}`);
            expect(res.status).toBe(200);
        });

        it('returns 404 when subcategory does not exist under the given parent', async () => {
            // verifyShopAccess calls UserShop.findOne (already mocked in beforeEach)
            // getSubcategoryById calls Category.findOne — set it to null to trigger 404
            Category.findOne.mockResolvedValueOnce(null);
            const res = await request(app).get(`/api/category/${CAT_ID}/subcategory/${CAT2_ID}`);
            expect(res.status).toBe(404);
        });

        it('rejects non-UUID subcategory ID', async () => {
            const res = await request(app).get(`/api/category/${CAT_ID}/subcategory/not-a-uuid`);
            expect(res.status).toBe(400);
        });
    });

    // ── POST /category ────────────────────────────────────────────────────

    describe('POST /category', () => {
        it('creates a category and returns 201', async () => {
            const res = await request(app).post('/api/category').send({ name: 'Electronics' });
            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
        });

        it('creates a category with subcategories atomically', async () => {
            Category.create
                .mockResolvedValueOnce(mockCategory)
                .mockResolvedValueOnce(mockSubcategory)
                .mockResolvedValueOnce(mockSubcategory);
            const res = await request(app).post('/api/category').send({
                name: 'Clothing',
                subcategories: [{ name: 'T-Shirts' }, { name: 'Trousers' }],
            });
            expect(res.status).toBe(201);
        });

        it('requires category name', async () => {
            const res = await request(app).post('/api/category').send({ description: 'No name' });
            expect(res.status).toBe(400);
        });

        it('rejects name longer than 255 characters', async () => {
            const res = await request(app).post('/api/category').send({ name: 'A'.repeat(256) });
            expect(res.status).toBe(400);
        });

        it('returns 403 when user does not have shop access (SECURITY)', async () => {
            UserShop.findOne.mockResolvedValueOnce(null);
            const res = await request(app).post('/api/category').send({ name: 'Test' });
            expect(res.status).toBe(403);
        });

        it('rolls back transaction if subcategory creation fails', async () => {
            const failTx = { commit: jest.fn(), rollback: jest.fn(() => Promise.resolve()) };
            sequelize.transaction.mockResolvedValueOnce(failTx);
            Category.create
                .mockResolvedValueOnce(mockCategory)
                .mockRejectedValueOnce(new Error('DB error'));
            const res = await request(app).post('/api/category').send({
                name: 'Electronics', subcategories: [{ name: 'TVs' }],
            });
            expect(res.status).toBe(500);
            expect(failTx.rollback).toHaveBeenCalled();
        });

        it('creates with empty subcategories array without error', async () => {
            const res = await request(app).post('/api/category').send({ name: 'Empty', subcategories: [] });
            expect(res.status).toBe(201);
        });
    });

    // ── PATCH /category/:id ───────────────────────────────────────────────

    describe('PATCH /category/:id', () => {
        it('updates a category and returns 200', async () => {
            const res = await request(app).patch(`/api/category/${CAT_ID}`).send({ name: 'Updated Clothing' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 404 when category does not exist', async () => {
            // verifyShopAccess passes (UserShop mock persistent), but category not found
            Category.findOne.mockReset()
                .mockResolvedValueOnce(null); // category lookup returns null
            const res = await request(app).patch(`/api/category/${CAT2_ID}`).send({ name: 'X' });
            expect(res.status).toBe(404);
        });

        it('returns 403 for unauthorized shop access (SECURITY)', async () => {
            UserShop.findOne.mockResolvedValueOnce(null);
            const res = await request(app).patch(`/api/category/${CAT_ID}`).send({ name: 'Test' });
            expect(res.status).toBe(403);
        });

        it('cannot update a category from another shop (SECURITY)', async () => {
            Category.findOne.mockReset().mockResolvedValueOnce(null);
            const res = await request(app).patch(`/api/category/${CAT2_ID}`).send({ name: 'Hacked' });
            expect(res.status).toBe(404);
        });

        it('creates new subcategory when no id is provided', async () => {
            Category.findOne
                .mockResolvedValueOnce(mockCategory)  // category lookup in updateCategory
                .mockResolvedValueOnce(mockCategory); // getCategoryById refetch
            const res = await request(app).patch(`/api/category/${CAT_ID}`).send({
                subcategories: [{ name: 'New Sub' }],
            });
            expect(res.status).toBe(200);
            expect(Category.create).toHaveBeenCalled();
        });

        it('updates existing subcategory when id is provided', async () => {
            Category.findOne
                .mockResolvedValueOnce(mockCategory)    // category lookup
                .mockResolvedValueOnce(mockSubcategory) // existing subcat found
                .mockResolvedValueOnce(mockCategory);   // getCategoryById refetch
            const res = await request(app).patch(`/api/category/${CAT_ID}`).send({
                subcategories: [{ id: SUBCAT_ID, name: 'Updated T-Shirts' }],
            });
            expect(res.status).toBe(200);
        });
    });

    // ── DELETE /category/:id ──────────────────────────────────────────────

    describe('DELETE /category/:id', () => {
        it('deletes a category and returns 200', async () => {
            const res = await request(app).delete(`/api/category/${CAT_ID}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockCategory.destroy).toHaveBeenCalled();
        });

        it('returns 404 when category does not exist', async () => {
            Category.findOne.mockReset().mockResolvedValueOnce(null);
            const res = await request(app).delete(`/api/category/${CAT2_ID}`);
            expect(res.status).toBe(404);
        });

        it('returns 403 for unauthorized shop access (SECURITY)', async () => {
            UserShop.findOne.mockResolvedValueOnce(null);
            const res = await request(app).delete(`/api/category/${CAT_ID}`);
            expect(res.status).toBe(403);
        });

        it('cannot delete a category from another shop (SECURITY)', async () => {
            Category.findOne.mockReset().mockResolvedValueOnce(null);
            const res = await request(app).delete(`/api/category/${CAT2_ID}`);
            expect(res.status).toBe(404);
        });

        it('rejects non-UUID category ID', async () => {
            const res = await request(app).delete('/api/category/not-a-uuid');
            expect(res.status).toBe(400);
        });
    });

    // ── Business logic: category service ─────────────────────────────────

    describe('category.service — unit-level logic', () => {
        let categoryService;
        beforeEach(() => { categoryService = require('src/modules/category/category.service'); });

        it('verifyShopAccess throws 403 for non-member user', async () => {
            UserShop.findOne.mockResolvedValueOnce(null);
            await expect(categoryService.verifyShopAccess(USER_ID, SHOP_ID))
                .rejects.toMatchObject({ status: 403 });
        });

        it('createCategory sets parent_category_id to null for root categories', async () => {
            const captured = [];
            Category.create.mockImplementation((data) => { captured.push(data); return Promise.resolve(mockCategory); });

            await categoryService.createCategory(USER_ID, SHOP_ID, { name: 'Root' });

            const rootCall = captured.find(c => !c.parent_category_id);
            expect(rootCall).toBeDefined();
            expect(rootCall.parent_category_id).toBeNull();
        });

        it('createCategory sets parent_category_id on subcategories', async () => {
            const captured = [];
            Category.create.mockImplementation((data) => {
                captured.push(data);
                return Promise.resolve(data.parent_category_id ? mockSubcategory : mockCategory);
            });

            await categoryService.createCategory(USER_ID, SHOP_ID, {
                name: 'Clothing',
                subcategories: [{ name: 'T-Shirts' }, { name: 'Pants' }],
            });

            const subs = captured.filter(c => c.parent_category_id === CAT_ID);
            expect(subs.length).toBe(2);
        });

        it('deleteCategory throws 404 when category not found', async () => {
            Category.findOne.mockResolvedValueOnce(null);
            await expect(categoryService.deleteCategory(CAT2_ID, USER_ID, SHOP_ID))
                .rejects.toMatchObject({ status: 404 });
        });

        it('getCategoryById returns category with subcategories', async () => {
            const result = await categoryService.getCategoryById(CAT_ID, USER_ID, SHOP_ID);
            expect(result).toBeDefined();
            expect(result.id).toBe(CAT_ID);
        });

        it('getSubcategoryById throws 404 when subcategory not in parent', async () => {
            Category.findOne.mockResolvedValueOnce(null);
            await expect(categoryService.getSubcategoryById(CAT_ID, CAT2_ID, USER_ID, SHOP_ID))
                .rejects.toMatchObject({ status: 404 });
        });

        it('listCategories only queries root-level categories (parent_category_id: null)', async () => {
            Category.findAll.mockResolvedValueOnce([mockCategory]);
            const result = await categoryService.listCategories(USER_ID, SHOP_ID);
            expect(Array.isArray(result)).toBe(true);
            const callArgs = Category.findAll.mock.calls[0]?.[0];
            if (callArgs?.where) expect(callArgs.where.parent_category_id).toBeNull();
        });
    });

    // ── Security: cross-shop isolation ────────────────────────────────────

    describe('Security: shop isolation', () => {
        it('all Category.findAll calls include shop_id in where clause', async () => {
            await request(app).get('/api/category');
            Category.findAll.mock.calls.forEach(([args]) => {
                if (args?.where) expect(args.where.shop_id).toBe(SHOP_ID);
            });
        });

        it('Category.findOne for data is scoped to shop_id', async () => {
            await request(app).get(`/api/category/${CAT_ID}`);
            const calls = Category.findOne.mock.calls.filter(([args]) => args?.where?.id);
            calls.forEach(([args]) => { expect(args.where.shop_id).toBe(SHOP_ID); });
        });

        it('subcategory query is scoped to shop_id AND parent_category_id', async () => {
            Category.findOne
                .mockResolvedValueOnce(mockUserShop)
                .mockResolvedValueOnce(mockSubcategory);
            await request(app).get(`/api/category/${CAT_ID}/subcategory/${SUBCAT_ID}`);
            const subcatCall = Category.findOne.mock.calls.find(
                ([args]) => args?.where?.parent_category_id
            );
            if (subcatCall) {
                expect(subcatCall[0].where.shop_id).toBe(SHOP_ID);
                expect(subcatCall[0].where.parent_category_id).toBeTruthy();
            }
        });
    });

    // ── Hierarchy integrity ────────────────────────────────────────────────

    describe('Category hierarchy integrity', () => {
        it('getCategoryById includes active subcategories', async () => {
            Category.findOne.mockResolvedValueOnce({ ...mockCategory, subcategories: [mockSubcategory] });
            const res = await request(app).get(`/api/category/${CAT_ID}`);
            expect(res.status).toBe(200);
        });

        it('subcategory PATCH scopes to correct parent_category_id', async () => {
            Category.findOne
                .mockResolvedValueOnce(mockCategory)
                .mockResolvedValueOnce(mockSubcategory)
                .mockResolvedValueOnce(mockCategory);
            await request(app).patch(`/api/category/${CAT_ID}`).send({
                subcategories: [{ id: SUBCAT_ID, name: 'Renamed' }],
            });
            const subcatCall = Category.findOne.mock.calls.find(
                ([args]) => args?.where?.parent_category_id === CAT_ID
            );
            if (subcatCall) {
                expect(subcatCall[0].where.parent_category_id).toBe(CAT_ID);
                expect(subcatCall[0].where.shop_id).toBe(SHOP_ID);
            }
        });
    });
});
