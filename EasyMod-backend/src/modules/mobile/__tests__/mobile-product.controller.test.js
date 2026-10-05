'use strict';

jest.mock('../../entities', () => ({
    AuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-prod-1' }),
    },
    Product: {
        findOne: jest.fn(),
        findAndCountAll: jest.fn(),
        create: jest.fn(),
    },
    Category: {
        findOne: jest.fn(),
    },
}));

const { AuditLog, Product, Category } = require('../../entities');
const controller = require('../mobile-product.controller');

function response() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

describe('mobile Product Helper & Quick Update controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getProducts', () => {
        test('returns paginated products with formatted fields and stock status', async () => {
            const res = response();
            const mockProducts = [
                {
                    id: 'prod-1',
                    name: 'Cotton T-Shirt',
                    name_bn: 'সুতি টি-শার্ট',
                    sku: 'TS-01',
                    price: '550.00',
                    compare_at_price: '700.00',
                    quantity: 12,
                    low_stock_threshold: 5,
                    track_quantity: true,
                    in_stock: true,
                    image_url: 'https://example.com/tshirt.jpg',
                    images: ['https://example.com/tshirt.jpg'],
                    description: 'Premium quality cotton t-shirt',
                    is_active: true,
                    createdAt: new Date('2026-09-01T10:00:00Z'),
                    updatedAt: new Date('2026-09-01T12:00:00Z'),
                    category_ref: { id: 'cat-1', name: 'Apparel' },
                    toJSON: function() { return this; },
                },
                {
                    id: 'prod-2',
                    name: 'Leather Wallet',
                    price: '1200.00',
                    quantity: 2,
                    low_stock_threshold: 5,
                    track_quantity: true,
                    in_stock: true,
                    description: 'Genuine leather',
                    is_active: true,
                    toJSON: function() { return this; },
                },
                {
                    id: 'prod-3',
                    name: 'Out of Stock Shoes',
                    price: '2500.00',
                    quantity: 0,
                    low_stock_threshold: 5,
                    track_quantity: true,
                    in_stock: false,
                    is_active: true,
                    toJSON: function() { return this; },
                },
            ];

            Product.findAndCountAll.mockResolvedValue({
                count: 3,
                rows: mockProducts,
            });

            await controller.getProducts({
                query: { page: 1, limit: 20 },
                shop: { id: 'shop-1' },
            }, res, jest.fn());

            expect(res.json).toHaveBeenCalled();
            const resBody = res.json.mock.calls[0][0];
            expect(resBody.success).toBe(true);
            expect(resBody.data.products).toHaveLength(3);
            expect(resBody.data.products[0].stock_status).toBe('in_stock');
            expect(resBody.data.products[0].price).toBe(550);
            expect(resBody.data.products[1].stock_status).toBe('low_stock');
            expect(resBody.data.products[2].stock_status).toBe('out_of_stock');
            expect(resBody.data.pagination.total_items).toBe(3);
        });

        test('applies search and stock_status filters correctly', async () => {
            const res = response();
            Product.findAndCountAll.mockResolvedValue({
                count: 0,
                rows: [],
            });

            await controller.getProducts({
                query: { search: 'wallet', stock_status: 'low_stock' },
                shop: { id: 'shop-1' },
            }, res, jest.fn());

            expect(Product.findAndCountAll).toHaveBeenCalled();
            const queryArgs = Product.findAndCountAll.mock.calls[0][0];
            expect(queryArgs.where.shop_id).toBe('shop-1');
            expect(queryArgs.where.in_stock).toBe(true);
            expect(queryArgs.where.quantity).toBeDefined();
        });
    });

    describe('quickUpdateStock', () => {
        test('throws 404 when product is not found in shop', async () => {
            const res = response();
            Product.findOne.mockResolvedValue(null);

            let thrownError = null;
            try {
                await controller.quickUpdateStock({
                    params: { productId: 'prod-unknown' },
                    body: { stockDelta: 5 },
                    shop: { id: 'shop-1' },
                    user: { id: 'user-1' },
                }, res, (err) => { thrownError = err; });
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeTruthy();
            expect(thrownError.status).toBe(404);
        });

        test('throws 400 when newStock is negative', async () => {
            const res = response();
            Product.findOne.mockResolvedValue({
                id: 'prod-1',
                shop_id: 'shop-1',
                quantity: 10,
                price: 500,
                in_stock: true,
                update: jest.fn(),
            });

            let thrownError = null;
            try {
                await controller.quickUpdateStock({
                    params: { productId: 'prod-1' },
                    body: { newStock: -5 },
                    shop: { id: 'shop-1' },
                    user: { id: 'user-1' },
                }, res, (err) => { thrownError = err; });
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeTruthy();
            expect(thrownError.status).toBe(400);
        });

        test('updates stock delta atomically and prevents negative stock', async () => {
            const res = response();
            const mockProduct = {
                id: 'prod-1',
                shop_id: 'shop-1',
                quantity: 3,
                price: 500,
                in_stock: true,
                update: jest.fn().mockImplementation(function(fields) {
                    Object.assign(this, fields);
                    return Promise.resolve(this);
                }),
                toJSON: function() { return this; },
            };
            Product.findOne.mockResolvedValue(mockProduct);

            await controller.quickUpdateStock({
                params: { productId: 'prod-1' },
                body: { stockDelta: -5 }, // 3 - 5 should floor at 0
                shop: { id: 'shop-1' },
                user: { id: 'user-1' },
            }, res, jest.fn());

            expect(mockProduct.update).toHaveBeenCalledWith({
                quantity: 0,
                in_stock: false,
                price: 500,
            });

            expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                action: 'PRODUCT_STOCK_UPDATED',
                resource_id: 'prod-1',
                metadata: expect.objectContaining({
                    source: 'MOBILE',
                    previous_quantity: 3,
                    next_quantity: 0,
                }),
            }));

            expect(res.json).toHaveBeenCalled();
            const resBody = res.json.mock.calls[0][0];
            expect(resBody.data.quantity).toBe(0);
            expect(resBody.data.in_stock).toBe(false);
            expect(resBody.data.stock_status).toBe('out_of_stock');
        });

        test('updates absolute stock and new price', async () => {
            const res = response();
            const mockProduct = {
                id: 'prod-1',
                shop_id: 'shop-1',
                quantity: 1,
                price: 500,
                in_stock: true,
                update: jest.fn().mockImplementation(function(fields) {
                    Object.assign(this, fields);
                    return Promise.resolve(this);
                }),
                toJSON: function() { return this; },
            };
            Product.findOne.mockResolvedValue(mockProduct);

            await controller.quickUpdateStock({
                params: { productId: 'prod-1' },
                body: { newStock: 25, newPrice: 650 },
                shop: { id: 'shop-1' },
                user: { id: 'user-1' },
            }, res, jest.fn());

            expect(mockProduct.update).toHaveBeenCalledWith({
                quantity: 25,
                in_stock: true,
                price: 650,
            });

            const resBody = res.json.mock.calls[0][0];
            expect(resBody.data.quantity).toBe(25);
            expect(resBody.data.price).toBe(650);
            expect(resBody.data.stock_status).toBe('in_stock');
        });
    });

    describe('createPhotoDraft', () => {
        test('throws 400 if product name is missing', async () => {
            const res = response();
            let thrownError = null;
            try {
                await controller.createPhotoDraft({
                    body: { price: 500 },
                    shop: { id: 'shop-1' },
                    user: { id: 'user-1' },
                }, res, (err) => { thrownError = err; });
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeTruthy();
            expect(thrownError.status).toBe(400);
        });

        test('throws 400 if price is invalid or non-positive', async () => {
            const res = response();
            let thrownError = null;
            try {
                await controller.createPhotoDraft({
                    body: { name: 'Smart Watch', price: 0 },
                    shop: { id: 'shop-1' },
                    user: { id: 'user-1' },
                }, res, (err) => { thrownError = err; });
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeTruthy();
            expect(thrownError.status).toBe(400);
        });

        test('creates product as DRAFT (is_active: false) and logs audit', async () => {
            const res = response();
            const createdDraft = {
                id: 'prod-draft-1',
                shop_id: 'shop-1',
                name: 'Silk Panjabi',
                price: 1800,
                quantity: 5,
                is_active: false, // CRITICAL: NEVER auto-published
                in_stock: true,
                track_quantity: true,
                image_url: 'https://example.com/panjabi.jpg',
                images: ['https://example.com/panjabi.jpg'],
                toJSON: function() { return this; },
            };
            Product.create.mockResolvedValue(createdDraft);

            await controller.createPhotoDraft({
                body: {
                    name: 'Silk Panjabi',
                    price: 1800,
                    quantity: 5,
                    image_url: 'https://example.com/panjabi.jpg',
                },
                shop: { id: 'shop-1' },
                user: { id: 'user-1' },
            }, res, jest.fn());

            expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({
                shop_id: 'shop-1',
                name: 'Silk Panjabi',
                price: 1800,
                quantity: 5,
                is_active: false, // CRITICAL
            }));

            expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                action: 'PRODUCT_DRAFT_CREATED',
                resource_id: 'prod-draft-1',
                metadata: expect.objectContaining({
                    source: 'MOBILE',
                    is_active: false,
                }),
            }));

            expect(res.json).toHaveBeenCalled();
            const resBody = res.json.mock.calls[0][0];
            expect(resBody.data.is_active).toBe(false);
            expect(resBody.data.name).toBe('Silk Panjabi');
        });
    });
});
