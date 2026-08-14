'use strict';

const fs = require('fs/promises');
const path = require('path');

process.env.EASYMOD_UPLOAD_ROOT = path.resolve(__dirname, '../../../..', '.test-uploads');

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async () => ({
            commit: jest.fn(),
            rollback: jest.fn(),
        })),
        getDialect: jest.fn(() => 'postgres'),
        query: jest.fn(async () => [[]]),
    },
}));

jest.mock('../../entities', () => ({
    Product: { findAll: jest.fn() },
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../../utils/image-upload.service', () => {
    const actual = jest.requireActual('../../../utils/image-upload.service');
    return {
        ...actual,
        saveDataUrlImage: jest.fn(actual.saveDataUrlImage),
    };
});

const {
    cleanupProductMediaOrphans,
    getProductMediaPaths,
    removeUnreferencedProductMedia,
    storeProductImage,
} = require('../product-media.service');
const { Product } = require('../../entities');
const { saveDataUrlImage, UPLOAD_ROOT } = require('../../../utils/image-upload.service');
const { sequelize } = require('../../../utils/database/database-setup');

const SHOP_ID = 'product-media-quota-test';
const OTHER_SHOP_ID = 'other-shop';
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_DATA_URL.split(',')[1], 'base64').length;

const shopDir = path.join(UPLOAD_ROOT, 'product-images', SHOP_ID);

describe('product-media.service', () => {
    beforeEach(async () => {
        process.env.PRODUCT_IMAGE_QUOTA_BYTES = String(PNG_BYTES);
        Product.findAll.mockReset().mockResolvedValue([]);
        sequelize.query.mockReset().mockResolvedValue([[]]);
        sequelize.getDialect.mockReturnValue('postgres');
        saveDataUrlImage.mockReset().mockImplementation(
            jest.requireActual('../../../utils/image-upload.service').saveDataUrlImage
        );
        await fs.rm(shopDir, { recursive: true, force: true });
    });

    afterAll(async () => {
        delete process.env.PRODUCT_IMAGE_QUOTA_BYTES;
        await fs.rm(shopDir, { recursive: true, force: true });
    });

    it('accepts only local media owned by the authenticated shop', () => {
        const own = `/uploads/product-images/${SHOP_ID}/image.png`;
        const other = `/uploads/product-images/${OTHER_SHOP_ID}/other.png`;
        expect(getProductMediaPaths([own, other, 'https://cdn.example.com/image.png'], null, SHOP_ID))
            .toEqual([own]);
    });

    it('rejects a single upload that exceeds the tenant quota', async () => {
        process.env.PRODUCT_IMAGE_QUOTA_BYTES = String(PNG_BYTES - 1);
        await expect(storeProductImage({ dataUrl: PNG_DATA_URL, shopId: SHOP_ID, maxBytes: 5 * 1024 * 1024 }))
            .rejects.toMatchObject({ code: 'PRODUCT_IMAGE_QUOTA_EXCEEDED', status: 413 });
        expect(saveDataUrlImage).not.toHaveBeenCalled();
    });

    it('enforces the cumulative quota across concurrent uploads', async () => {
        const results = await Promise.allSettled([
            storeProductImage({ dataUrl: PNG_DATA_URL, shopId: SHOP_ID, maxBytes: 5 * 1024 * 1024 }),
            storeProductImage({ dataUrl: PNG_DATA_URL, shopId: SHOP_ID, maxBytes: 5 * 1024 * 1024 }),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')[0].reason.code)
            .toBe('PRODUCT_IMAGE_QUOTA_EXCEEDED');
        expect(await fs.readdir(shopDir)).toHaveLength(1);
    });

    it('does not leave a file or quota reservation when storage fails', async () => {
        saveDataUrlImage.mockRejectedValueOnce(new Error('disk full'));
        await expect(storeProductImage({ dataUrl: PNG_DATA_URL, shopId: SHOP_ID, maxBytes: 5 * 1024 * 1024 }))
            .rejects.toThrow('disk full');
        expect(await fs.rm(shopDir, { recursive: true, force: true })).toBeUndefined();
    });

    it('deletes an unreferenced file so a later upload can reuse the quota', async () => {
        const first = await storeProductImage({ dataUrl: PNG_DATA_URL, shopId: SHOP_ID, maxBytes: 5 * 1024 * 1024 });
        const removed = await removeUnreferencedProductMedia({ shopId: SHOP_ID, images: [first.publicPath] });
        expect(removed).toMatchObject({ removed: 1, bytes: PNG_BYTES });
        await expect(storeProductImage({ dataUrl: PNG_DATA_URL, shopId: SHOP_ID, maxBytes: 5 * 1024 * 1024 }))
            .resolves.toBeDefined();
    });

    it('sweeps old orphan files but preserves referenced files', async () => {
        process.env.PRODUCT_IMAGE_QUOTA_BYTES = String(PNG_BYTES * 2);
        const orphan = await storeProductImage({ dataUrl: PNG_DATA_URL, shopId: SHOP_ID, maxBytes: 5 * 1024 * 1024 });
        const referenced = await storeProductImage({
            dataUrl: PNG_DATA_URL,
            shopId: SHOP_ID,
            maxBytes: 10 * 1024 * 1024,
        });
        Product.findAll.mockResolvedValueOnce([{ id: 'product-1', images: [referenced.publicPath] }]);
        const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        await fs.utimes(path.join(UPLOAD_ROOT, orphan.publicPath.replace('/uploads/', '')), old, old);
        const result = await cleanupProductMediaOrphans({ shopId: SHOP_ID, olderThanMs: 0 });
        expect(result.removed).toBe(1);
        await expect(fs.access(path.join(UPLOAD_ROOT, referenced.publicPath.replace('/uploads/', ''))))
            .resolves.toBeUndefined();
    });
});
