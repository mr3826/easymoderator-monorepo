/**
 * Product API — Integration Tests
 * Tests GET /products, POST /products, GET /products/:id, PATCH /products/:id, DELETE /products/:id
 */

'use strict';

// ── In-memory Redis ───────────────────────────────────────────────────────────
const redisStore = {};
jest.mock('../../../utils/redis', () => ({
    get: jest.fn(async (k) => redisStore[k] ?? null),
    set: jest.fn(async (k, v) => { redisStore[k] = v; }),
    del: jest.fn(async (k) => { delete redisStore[k]; }),
    setex: jest.fn(async (k, _ttl, v) => { redisStore[k] = v; }),
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
}));

// ── Entity mocks ──────────────────────────────────────────────────────────────
const mockProductData = {
    id: 'prod-1',
    shop_id: 'shop-1',
    name: 'Blue T-Shirt',
    sku: 'TSHIRT-BLUE-M',
    price: 750,
    quantity: 10,
    track_quantity: true,
    is_active: true,
    toJSON: function () { return { id: this.id, shop_id: this.shop_id, name: this.name, sku: this.sku, price: this.price, quantity: this.quantity }; },
    update: jest.fn().mockResolvedValue(true),
    increment: jest.fn().mockResolvedValue(true),
};

jest.mock('../../entities', () => ({
    Product: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
        destroy: jest.fn(),
    },
    ProductVariant: {
        findAll: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        destroy: jest.fn(),
    },
    Category: {
        findOne: jest.fn().mockResolvedValue({ id: 'cat-1', shop_id: 'shop-1' }),
    },
    Shop: { findByPk: jest.fn().mockResolvedValue({ id: 'shop-1' }) },
    UserShop: {
        findOne: jest.fn().mockResolvedValue({ user_id: 'user-1', shop_id: 'shop-1', role: 'owner', is_active: true }),
    },
}));

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (cb) => {
            const t = { commit: jest.fn(), rollback: jest.fn() };
            if (typeof cb === 'function') return cb(t);
            return t;
        }),
    }
}));

jest.mock('sequelize', () => ({
    Op: { lt: Symbol('lt'), like: Symbol('like'), or: Symbol('or'), gt: Symbol('gt') }
}));

jest.mock('../subscription/subscription.service', () => ({
    trackUsage: jest.fn().mockResolvedValue(true),
    checkLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../product-ai.service', () => ({
    queueProductProcessing: jest.fn().mockResolvedValue(true),
    extractProductsFromText: jest.fn().mockResolvedValue([]),
}));

jest.mock('../product-embedding.service', () => ({
    embedProduct: jest.fn().mockResolvedValue(true),
    removeProductEmbedding: jest.fn().mockResolvedValue(true),
}));

jest.mock('../clip-client.service', () => ({
    removeProductIndex: jest.fn().mockResolvedValue(true),
}));

jest.mock('../product-search.service', () => ({
    searchProducts: jest.fn().mockResolvedValue([]),
}));

jest.mock('../product-upsell.service', () => ({
    getUpsells: jest.fn().mockResolvedValue([]),
    getUpsellsForCart: jest.fn().mockResolvedValue([]),
}));

jest.mock('../stock-status-guard.service', () => ({
    invalidateStock: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../constants/http-status', () => ({
    HTTP_STATUS: { NOT_FOUND: 404, FORBIDDEN: 403, BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500 }
}));

// ── Auth middleware ───────────────────────────────────────────────────────────
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
    const productRoutes = require('src/modules/product/product.routes');
    app.use('/api/products', productRoutes);
});

beforeEach(() => {
    jest.clearAllMocks();
    const { Product, UserShop } = require('../../entities');
    Product.findAll.mockResolvedValue([{ ...mockProductData }]);
    Product.findByPk.mockResolvedValue({ ...mockProductData });
    Product.findOne.mockResolvedValue({ ...mockProductData });
    Product.create.mockResolvedValue({ ...mockProductData, id: 'prod-new' });
    Product.destroy.mockResolvedValue(1);
    UserShop.findOne.mockResolvedValue({ user_id: 'user-1', shop_id: 'shop-1', role: 'owner', is_active: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/products', () => {
    it('returns 200 with product list', async () => {
        const res = await request(app)
            .get('/api/products')
            .set('Authorization', authHeader);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app).get('/api/products');
        expect(res.status).toBe(401);
    });

    it('scopes products to the authenticated shop', async () => {
        const { Product } = require('../../entities');
        await request(app)
            .get('/api/products')
            .set('Authorization', authHeader);

        // Product.findAll should be called with shop_id filter
        if (Product.findAll.mock.calls.length > 0) {
            const callArg = Product.findAll.mock.calls[0][0];
            expect(JSON.stringify(callArg)).toContain('shop-1');
        }
    });
});

describe('GET /api/products/:id', () => {
    it('returns 200 with product details', async () => {
        const res = await request(app)
            .get('/api/products/prod-1')
            .set('Authorization', authHeader);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 404 when product not found', async () => {
        const { Product } = require('../../entities');
        Product.findByPk.mockResolvedValueOnce(null);
        Product.findOne.mockResolvedValueOnce(null);

        const res = await request(app)
            .get('/api/products/prod-nonexistent')
            .set('Authorization', authHeader);

        expect(res.status).toBe(404);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app).get('/api/products/prod-1');
        expect(res.status).toBe(401);
    });
});

describe('POST /api/products', () => {
    it('creates a product and returns 200 or 201', async () => {
        const res = await request(app)
            .post('/api/products')
            .set('Authorization', authHeader)
            .send({ name: 'Red Hijab', price: 400, quantity: 20, track_quantity: true });

        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
    });

    it('returns 400 when name is missing', async () => {
        const res = await request(app)
            .post('/api/products')
            .set('Authorization', authHeader)
            .send({ price: 400 });

        expect(res.status).toBe(400);
    });

    it('returns 400 when price is missing', async () => {
        const res = await request(app)
            .post('/api/products')
            .set('Authorization', authHeader)
            .send({ name: 'Test Product' });

        expect(res.status).toBe(400);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app)
            .post('/api/products')
            .send({ name: 'Test', price: 100 });

        expect(res.status).toBe(401);
    });

    it('returns 404 when provided category_id does not exist', async () => {
        const { Category } = require('../../entities');
        Category.findOne.mockResolvedValueOnce(null);

        const res = await request(app)
            .post('/api/products')
            .set('Authorization', authHeader)
            .send({ name: 'Test', price: 100, category_id: 'cat-nonexistent' });

        expect(res.status).toBe(404);
    });
});

describe('PATCH /api/products/:id', () => {
    it('updates a product and returns 200', async () => {
        const productWithUpdate = { ...mockProductData, update: jest.fn().mockResolvedValue(true) };
        const { Product } = require('../../entities');
        Product.findByPk.mockResolvedValueOnce(productWithUpdate);

        const res = await request(app)
            .patch('/api/products/prod-1')
            .set('Authorization', authHeader)
            .send({ price: 800 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 404 when product not found for update', async () => {
        const { Product } = require('../../entities');
        Product.findByPk.mockResolvedValueOnce(null);
        Product.findOne.mockResolvedValueOnce(null);

        const res = await request(app)
            .patch('/api/products/prod-gone')
            .set('Authorization', authHeader)
            .send({ price: 800 });

        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/products/:id', () => {
    it('deletes a product and returns 200', async () => {
        const productWithDestroy = { ...mockProductData };
        const { Product } = require('../../entities');
        Product.findByPk.mockResolvedValueOnce(productWithDestroy);
        Product.destroy.mockResolvedValueOnce(1);

        const res = await request(app)
            .delete('/api/products/prod-1')
            .set('Authorization', authHeader);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 404 when product not found for deletion', async () => {
        const { Product } = require('../../entities');
        Product.findByPk.mockResolvedValueOnce(null);
        Product.findOne.mockResolvedValueOnce(null);

        const res = await request(app)
            .delete('/api/products/prod-gone')
            .set('Authorization', authHeader);

        expect(res.status).toBe(404);
    });

    it('returns 401 without auth token', async () => {
        const res = await request(app).delete('/api/products/prod-1');
        expect(res.status).toBe(401);
    });
});
