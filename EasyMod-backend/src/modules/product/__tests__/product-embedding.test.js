'use strict';

/**
 * product-embedding.service — embedProduct must respect ingestData's success
 * flag. ingestData swallows vector-store errors and returns { success:false }
 * instead of throwing; before the fix, embedProduct logged success regardless,
 * making "is this product embedded?" impossible to answer.
 */

process.env.NODE_ENV = 'test';

jest.mock('src/modules/rag/rag.service', () => ({
    ingestData: jest.fn(),
    deletePoint: jest.fn(() => Promise.resolve()),
}));
jest.mock('src/modules/product/product.entity', () => ({
    findOne: jest.fn(),
}));

const ragService = require('src/modules/rag/rag.service');
const Product = require('src/modules/product/product.entity');
const { embedProduct } = require('src/modules/product/product-embedding.service');

const fakeProduct = {
    id: 'p1', shop_id: 's1', is_active: true,
    name: 'Test Shirt', name_bn: null, variants: [], tags: [], ai_tags: [],
    description: 'a shirt'
};

beforeEach(() => {
    jest.clearAllMocks();
    Product.findOne.mockResolvedValue(fakeProduct);
});

describe('embedProduct', () => {
    test('returns false when ingestData reports failure (vector store unavailable)', async () => {
        ragService.ingestData.mockResolvedValue({ success: false, message: 'RAG service unavailable' });
        await expect(embedProduct('p1', 's1')).resolves.toBe(false);
        expect(ragService.ingestData).toHaveBeenCalledTimes(1);
    });

    test('returns true when ingestData succeeds', async () => {
        ragService.ingestData.mockResolvedValue({ success: true, ingestionId: 'uuid-1' });
        await expect(embedProduct('p1', 's1')).resolves.toBe(true);
    });

    test('skips ingest entirely for a missing/inactive product', async () => {
        Product.findOne.mockResolvedValue(null);
        await expect(embedProduct('p1', 's1')).resolves.toBe(false);
        expect(ragService.ingestData).not.toHaveBeenCalled();
    });
});
