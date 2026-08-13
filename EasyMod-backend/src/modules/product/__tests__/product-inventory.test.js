/**
 * Product Inventory — Unit Tests
 * Tests createProduct, updateProductStock, getProducts, deleteProduct
 * and the atomic stock increment utility
 */

'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })
}));

const mockProductData = {
    id: 'prod-1',
    shop_id: 'shop-1',
    name: 'Blue T-Shirt',
    sku: 'TSHIRT-BLUE-M',
    price: 750,
    quantity: 10,
    track_quantity: true,
    is_active: true,
    toJSON: function () { return { ...this }; },
    update: jest.fn().mockResolvedValue(true),
    increment: jest.fn().mockResolvedValue(true),
    reload: jest.fn().mockResolvedValue({ id: 'prod-1', quantity: 12 }),
    save: jest.fn().mockResolvedValue(true),
};

jest.mock('../../entities', () => ({
    Product: {
        findOne: jest.fn(),
        findAll: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
        destroy: jest.fn(),
    },
    ProductVariant: {
        create: jest.fn(),
        findAll: jest.fn(),
        destroy: jest.fn(),
    },
    Category: {
        findOne: jest.fn(),
    },
    Shop: { findByPk: jest.fn() },
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
        Op: {}
    }
}));

jest.mock('sequelize', () => ({
    Op: {
        lt: Symbol('lt'),
        like: Symbol('like'),
        or: Symbol('or'),
    }
}));

jest.mock('../../subscription/subscription.service', () => ({
    trackUsage: jest.fn().mockResolvedValue(true),
}));

jest.mock('../product-ai.service', () => ({
    queueProductProcessing: jest.fn().mockResolvedValue(true),
}));

jest.mock('../product-embedding.service', () => ({
    embedProduct: jest.fn().mockResolvedValue(true),
    removeProductEmbedding: jest.fn().mockResolvedValue(true),
}));

jest.mock('../clip-client.service', () => ({
    removeProductIndex: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../constants/http-status', () => ({
    HTTP_STATUS: { NOT_FOUND: 404, FORBIDDEN: 403, BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500 }
}));

const { Product, UserShop, Category } = require('../../entities');
const productService = require('src/modules/product/product.service');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Product Service — inventory', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        UserShop.findOne.mockResolvedValue({ user_id: 'user-1', shop_id: 'shop-1', role: 'owner', is_active: true });
        Product.findOne.mockResolvedValue({ ...mockProductData });
        Product.findByPk.mockResolvedValue({ ...mockProductData });
        Product.create.mockResolvedValue({ id: 'prod-new', ...mockProductData });
        Product.findAll.mockResolvedValue([{ ...mockProductData }]);
        Category.findOne.mockResolvedValue({ id: 'cat-1', shop_id: 'shop-1' });
    });

    // ── createProduct ──────────────────────────────────────────────────────────

    it('createProduct — creates and returns a new product', async () => {
        const result = await productService.createProduct('user-1', 'shop-1', {
            name: 'Blue T-Shirt',
            price: 750,
            quantity: 10,
            track_quantity: true,
        });
        expect(Product.create).toHaveBeenCalled();
        expect(result).toBeDefined();
    });

    it('createProduct — verifies shop access before creating', async () => {
        await productService.createProduct('user-1', 'shop-1', { name: 'Test', price: 100 });
        expect(UserShop.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ user_id: 'user-1', shop_id: 'shop-1' }) })
        );
    });

    it('createProduct — throws 403 if user has no shop access', async () => {
        UserShop.findOne.mockResolvedValueOnce(null);
        await expect(productService.createProduct('user-x', 'shop-1', { name: 'Test' }))
            .rejects.toMatchObject({ status: 403 });
    });

    it('createProduct — sets quantity to 0 when track_quantity is false', async () => {
        await productService.createProduct('user-1', 'shop-1', {
            name: 'Digital Good',
            price: 50,
            track_quantity: false,
            quantity: 99,
        });
        expect(Product.create).toHaveBeenCalledWith(
            expect.objectContaining({ quantity: 0 }),
            expect.anything()
        );
    });

    it('createProduct — validates category exists if category_id provided', async () => {
        Category.findOne.mockResolvedValueOnce(null);
        await expect(productService.createProduct('user-1', 'shop-1', {
            name: 'Test',
            price: 100,
            category_id: 'cat-999'
        })).rejects.toMatchObject({ status: 404 });
    });

    // ── getProductsCursor / updateProductStock — REMOVED ──────────────────────
    //
    // Both functions exist in product.service.js (lines 18 and 30) but are not
    // in its module.exports and are not referenced anywhere in src/. No
    // production path can reach either one, so tests for them measured nothing:
    // they asserted against code that cannot run outside this file.
    //
    // The live equivalents, which are covered:
    //   listing          → listProducts (exported, used by product.controller)
    //   stock movement   → product.increment('quantity', { by }) in
    //                      order.service cancelOrder / return.service
    //                      updateReturnStatus, covered by
    //                      order-cancel-inventory.test.js
    //
    // The two dead functions themselves are left in place: deleting product
    // code is outside this PR's scope. They are listed as cleanup candidates in
    // docs/testing/WHOLE_APP_TEST_ARCHITECTURE.md.

    it('verifyShopAccess — returns userShop when access is valid', async () => {
        const mockUserShop = { user_id: 'user-1', shop_id: 'shop-1', role: 'owner' };
        UserShop.findOne.mockResolvedValueOnce(mockUserShop);
        const result = await productService.verifyShopAccess('user-1', 'shop-1');
        expect(result).toEqual(mockUserShop);
    });
});
