'use strict';

process.env.NODE_ENV = 'test';

const {
    SOURCE_TABLES,
    SOURCE_COUNT_RULE,
    SOURCE_QUERIES,
    assertRequiredSourceRelations,
    collectSourceStats,
} = require('src/modules/knowledge/index-source.contract');

const rowsFor = (rows) => jest.fn(async () => ({ rows }));

describe('Qdrant reindex PostgreSQL source contract', () => {
    it('keeps the Qdrant collection identifier out of the PostgreSQL source contract', () => {
        expect(SOURCE_TABLES).toEqual(['shops', 'faq_responses', 'products']);
        expect(SOURCE_TABLES).not.toContain('knowledge_documents');
        expect(Object.values(SOURCE_QUERIES).join(' ')).not.toMatch(/knowledge_documents/i);
    });

    it('defines the source-count rule once for reindex and proof consumers', () => {
        expect(SOURCE_COUNT_RULE).toContain('business-info');
        expect(SOURCE_COUNT_RULE).toContain('active FAQ');
        expect(SOURCE_COUNT_RULE).toContain('active product');
        expect(SOURCE_QUERIES.activeProducts).toContain('LIMIT 200');
    });

    it('rejects missing required relations instead of silently treating them as empty', async () => {
        const query = rowsFor([{ table_name: 'shops' }, { table_name: 'faq_responses' }]);

        await expect(assertRequiredSourceRelations(query)).rejects.toThrow(
            'missing PostgreSQL source relation(s): products',
        );
    });

    it('rejects a zero-source database instead of accepting an empty proof baseline', async () => {
        const query = jest.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('information_schema.tables')) {
                return { rows: SOURCE_TABLES.map((table_name) => ({ table_name })) };
            }
            if (text.includes('FROM shops')) return { rows: [] };
            throw new Error(`unexpected query: ${text}`);
        });

        await expect(collectSourceStats(query)).rejects.toThrow('no indexable PostgreSQL sources found');
    });

    it('counts the same non-empty business, FAQ, and product sources selected by reindex', async () => {
        const query = jest.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('information_schema.tables')) {
                return { rows: SOURCE_TABLES.map((table_name) => ({ table_name })) };
            }
            if (text.includes('FROM shops')) {
                return { rows: [{ id: 'shop-1', settings: { businessInfo: { shopName: 'Rina Fashion' } } }] };
            }
            if (text.includes('FROM faq_responses')) {
                return { rows: [{ id: 7, shop_id: 'shop-1', category: 'COD', template_en: 'Cash on delivery' }] };
            }
            if (text.includes('FROM products')) {
                return { rows: [{ id: 'product-1', shop_id: 'shop-1', name: 'Cotton shirt', variants: [], tags: [] }] };
            }
            throw new Error(`unexpected query: ${text}`);
        });

        await expect(collectSourceStats(query)).resolves.toMatchObject({
            count: 3,
            shopIds: ['shop-1'],
        });
    });
});
