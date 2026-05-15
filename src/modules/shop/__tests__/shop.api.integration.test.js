/**
 * Shop API — Integration Tests
 * Tests /shop/list, /shop/create, /shop/update, /shop/delete, /shop/business-info
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
const mockShopInstance = {
    id: 'shop-1',
    shop_name: 'My BD Shop',
    name: 'My BD Shop',
    unique_code: 'SHOP1',
    settings: { businessInfo: { shopName: 'My BD Shop' } },
    toJSON: function () { return { id: this.id, shop_name: this.shop_name, name: this.name, unique_code: this.unique_code, settings: this.settings }; },
    update: jest.fn().mockResolvedValue(true),
};

const mockUserShop = {
    user_id: 'user-1',
    shop_id: 'shop-1',
    role: 'owner',
    is_active: true,
    shop: mockShopInstance,
    toJSON: () => ({ user_id: 'user-1', shop_id: 'shop-1', role: 'owner' }),
};

jest.mock('../../entities', () => ({
    User: { findByPk: jest.fn() },
    Shop: {
        findByPk: jest.fn(),
        create: jest.fn(),
        destroy: jest.fn(),
        findAll: jest.fn(),
    },
    UserShop: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        destroy: jest.fn(),
    },
    Tenant: { findByPk: jest.fn() },
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

jest.mock('../shop-defaults', () => ({
    DEFAULT_AI_SETTINGS: { primary_provider: 'gemini', fallback_provider: 'openai' }
}));

jest.mock('../shop-settings.validator', () => ({
    validateAISettings: jest.fn().mockReturnValue({ valid: true }),
    validateSettings: jest.fn().mockReturnValue({ valid: true }),
    sanitizeSettings: jest.fn((s) => s),
}));

// ── JWT auth ──────────────────────────────────────────────────────────────────
jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: (req, _res, next) => {
        const auth = req.headers.authorization || '';
        if (!auth.startsWith('Bearer ')) {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.userId = 'user-1';
        req.shopId = 'shop-1';
        next();
    }
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');

const validToken = jwt.sign({ id: 'user-1', shopId: 'shop-1' }, 'test-access-secret', { expiresIn: '1h' });
const authHeader = `Bearer ${validToken}`;

let app;
beforeAll(() => {
    app = express();
    app.use(express.json());
    const shopRoutes = require('src/modules/shop/shop.routes');
    app.use('/shop', shopRoutes);
});

beforeEach(() => {
    jest.clearAllMocks();
    const { Shop, UserShop } = require('../../entities');
    Shop.findByPk.mockResolvedValue({ ...mockShopInstance, update: jest.fn().mockResolvedValue(true) });
    Shop.create.mockResolvedValue({ ...mockShopInstance, toJSON: mockShopInstance.toJSON });
    Shop.destroy.mockResolvedValue(1);
    UserShop.findOne.mockResolvedValue({ ...mockUserShop });
    UserShop.findAll.mockResolvedValue([{ ...mockUserShop }]);
    UserShop.create.mockResolvedValue({ id: 'us-1' });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /shop/list', () => {
    it('returns 200 with shops for authenticated user', async () => {
        const res = await request(app)
            .get('/shop/list')
            .set('Authorization', authHeader);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app).get('/shop/list');
        expect(res.status).toBe(401);
    });

    it('returns empty array when user has no shops', async () => {
        const { UserShop } = require('../../entities');
        UserShop.findAll.mockResolvedValueOnce([]);
        const res = await request(app)
            .get('/shop/list')
            .set('Authorization', authHeader);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
    });
});

describe('POST /shop/create', () => {
    it('creates a shop and returns 200', async () => {
        const res = await request(app)
            .post('/shop/create')
            .set('Authorization', authHeader)
            .send({ shop_name: 'New BD Shop' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app)
            .post('/shop/create')
            .send({ shop_name: 'Unauthorized Shop' });

        expect(res.status).toBe(401);
    });

    it('calls Shop.create with provided shop_name', async () => {
        const { Shop } = require('../../entities');
        await request(app)
            .post('/shop/create')
            .set('Authorization', authHeader)
            .send({ shop_name: 'Fashion Store BD' });

        expect(Shop.create).toHaveBeenCalledWith(
            expect.objectContaining({ shop_name: 'Fashion Store BD' }),
            expect.anything()
        );
    });
});

describe('POST /shop/update', () => {
    it('updates shop and returns 200', async () => {
        const shopWithUpdate = { ...mockShopInstance, update: jest.fn().mockResolvedValue(true) };
        const { Shop } = require('../../entities');
        Shop.findByPk.mockResolvedValueOnce(shopWithUpdate);

        const res = await request(app)
            .post('/shop/update')
            .set('Authorization', authHeader)
            .send({ shop_id: 'shop-1', shop_name: 'Updated Shop' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 404 when shop not found', async () => {
        const { UserShop } = require('../../entities');
        UserShop.findOne.mockResolvedValueOnce(null);

        const res = await request(app)
            .post('/shop/update')
            .set('Authorization', authHeader)
            .send({ shop_id: 'shop-missing', shop_name: 'X' });

        expect(res.status).toBe(404);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app)
            .post('/shop/update')
            .send({ shop_id: 'shop-1', shop_name: 'X' });

        expect(res.status).toBe(401);
    });
});

describe('POST /shop/delete', () => {
    it('deletes shop when user is owner and returns 200', async () => {
        const res = await request(app)
            .post('/shop/delete')
            .set('Authorization', authHeader)
            .send({ shop_id: 'shop-1' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 403 when user is not owner', async () => {
        const { UserShop } = require('../../entities');
        UserShop.findOne.mockResolvedValueOnce(null); // owner check fails

        const res = await request(app)
            .post('/shop/delete')
            .set('Authorization', authHeader)
            .send({ shop_id: 'shop-1' });

        expect(res.status).toBe(403);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app)
            .post('/shop/delete')
            .send({ shop_id: 'shop-1' });

        expect(res.status).toBe(401);
    });
});

describe('GET /shop/business-info', () => {
    it('returns 200 with business info for authenticated user', async () => {
        const res = await request(app)
            .get('/shop/business-info')
            .set('Authorization', authHeader);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app).get('/shop/business-info');
        expect(res.status).toBe(401);
    });
});

describe('GET /shop/me', () => {
    it('returns 200 with current shop info', async () => {
        const res = await request(app)
            .get('/shop/me')
            .set('Authorization', authHeader);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
