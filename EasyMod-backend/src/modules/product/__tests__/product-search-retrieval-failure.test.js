'use strict';

process.env.NODE_ENV = 'test';

jest.mock('src/utils/database/database-setup', () => ({
    sequelize: { query: jest.fn() },
}));

const { sequelize } = require('src/utils/database/database-setup');
const { searchByAttributes, getProductsByIds } = require('src/modules/product/product-search.service');

describe('AI product retrieval failure reporting', () => {
    beforeEach(() => jest.clearAllMocks());

    test('AI callers can distinguish a database outage from an empty catalog result', async () => {
        const databaseError = new Error('catalog unavailable');
        sequelize.query.mockRejectedValueOnce(databaseError);

        await expect(searchByAttributes({
            shopId: 'shop-a',
            query: 'black panjabi',
            throwOnError: true,
        })).rejects.toBe(databaseError);
    });

    test('legacy callers keep the existing empty-list fallback by default', async () => {
        sequelize.query.mockRejectedValueOnce(new Error('catalog unavailable'));

        await expect(searchByAttributes({ shopId: 'shop-a', query: 'black panjabi' }))
            .resolves.toEqual([]);
    });

    test('live relational variants and owner shop id are carried into AI evidence', async () => {
        sequelize.query.mockResolvedValueOnce([{
            id: 'product-1',
            shop_id: 'shop-a',
            name: 'Classic Blue Denim Jacket',
            price: '3200.00',
            in_stock: true,
            is_active: true,
            aliases: ['Blue jacket'],
            variants: [],
            product_variants: [{
                id: 'variant-xl',
                option_name: 'Size',
                option_value: 'XL',
                price: '3300.00',
                quantity: 2,
                is_active: true,
                attributes: {},
            }],
        }]);

        const [product] = await getProductsByIds(['product-1'], 'shop-a');
        const [sql, options] = sequelize.query.mock.calls[0];

        expect(sql).toContain('LEFT JOIN LATERAL');
        expect(sql).toContain('p.aliases');
        expect(sql).toContain('p.shop_id = :shopId');
        expect(options.replacements.shopId).toBe('shop-a');
        expect(product.shop_id).toBe('shop-a');
        expect(product.aliases).toEqual(['Blue jacket']);
        expect(product.variants).toEqual([expect.objectContaining({ option_value: 'XL', quantity: 2 })]);
    });
});
