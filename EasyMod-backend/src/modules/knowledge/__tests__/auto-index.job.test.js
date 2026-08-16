'use strict';

/**
 * Regression tests for the knowledge auto-index job and its shared source
 * contract. The Qdrant collection name must never become a PostgreSQL source
 * table, and missing source relations must fail before any ingest attempt.
 */

process.env.NODE_ENV = 'test';

jest.mock('src/utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const mockIngest = jest.fn(() => Promise.resolve({ success: true }));
jest.mock('src/modules/rag/rag.service', () => ({ ingestData: (...a) => mockIngest(...a) }));

const mockEmbedProduct = jest.fn(() => Promise.resolve(true));
jest.mock('src/modules/product/product-embedding.service', () => ({ embedProduct: (...a) => mockEmbedProduct(...a) }));

const mockQuery = jest.fn();
jest.mock('src/utils/database/database-setup', () => ({ sequelize: { query: (...a) => mockQuery(...a) } }));

const sourceRelations = ['shops', 'faq_responses', 'products'];
let shopRow;
let faqRows;
let productRows;
let availableRelations;

const installSourceQueryMock = () => {
    mockQuery.mockImplementation((sql) => {
        const text = String(sql);
        if (text.includes('information_schema.tables')) {
            return Promise.resolve([availableRelations.map((table_name) => ({ table_name }))]);
        }
        if (text.includes('FROM shops') && text.includes('WHERE id = $1')) {
            return Promise.resolve([[shopRow].filter(Boolean)]);
        }
        if (text.includes('FROM shops')) return Promise.resolve([[shopRow].filter(Boolean)]);
        if (text.includes('FROM faq_responses')) return Promise.resolve([faqRows]);
        if (text.includes('FROM products')) return Promise.resolve([productRows]);
        throw new Error(`unexpected source SQL: ${text}`);
    });
};

const { indexShop } = require('src/modules/knowledge/auto-index.job');

describe('auto-index.job — shared PostgreSQL source contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        shopRow = null;
        faqRows = [];
        productRows = [];
        availableRelations = [...sourceRelations];
        mockIngest.mockResolvedValue({ success: true });
        mockEmbedProduct.mockResolvedValue(true);
        installSourceQueryMock();
    });

    it('embeds FAQ category plus bilingual templates through the shared source selection', async () => {
        faqRows = [
            { id: 7, shop_id: 'shop-1', category: 'ডেলিভারি চার্জ', template_bn: 'ঢাকায় ৬০৳', template_en: 'Dhaka 60 BDT' },
        ];

        const res = await indexShop('shop-1');

        expect(res).toMatchObject({ errors: 0, indexed: 1, sourceCount: 1 });
        const { text, metadata } = mockIngest.mock.calls[0][0];
        expect(text).toContain('Q: ডেলিভারি চার্জ');
        expect(text).toContain('A (BN): ঢাকায় ৬০৳');
        expect(text).toContain('A (EN): Dhaka 60 BDT');
        expect(text).not.toContain('undefined');
        expect(metadata).toMatchObject({ type: 'faq', shopId: 'shop-1' });
    });

    it('does not query the Qdrant collection name as a PostgreSQL table', async () => {
        await indexShop('shop-1');

        const sqls = mockQuery.mock.calls.map((call) => String(call[0]));
        expect(sqls.some((sql) => /FROM\s+knowledge_documents\b/i.test(sql))).toBe(false);
        expect(sqls.some((sql) => /FROM\s+shop_knowledge_documents\b/i.test(sql))).toBe(false);
        expect(sqls.some((sql) => /FROM\s+(shops|faq_responses|products)\b/i.test(sql))).toBe(true);
    });

    it('fails closed when a required source relation is missing', async () => {
        availableRelations = ['shops', 'faq_responses'];

        await expect(indexShop('shop-1')).rejects.toThrow(
            'missing PostgreSQL source relation(s): products',
        );
        expect(mockIngest).not.toHaveBeenCalled();
        expect(mockEmbedProduct).not.toHaveBeenCalled();
    });

    it('counts a swallowed ingest failure as an error, not a silent success', async () => {
        faqRows = [
            { id: 1, shop_id: 'shop-1', category: 'COD', template_bn: 'ক্যাশ অন ডেলিভারি', template_en: 'Cash on delivery' },
        ];
        mockIngest.mockResolvedValueOnce({ success: false, message: 'RAG service unavailable' });

        const res = await indexShop('shop-1');

        expect(res).toMatchObject({ indexed: 0, errors: 1, sourceCount: 1 });
    });

    it('indexes additional owner business info and openingHours from the same shop source row', async () => {
        shopRow = {
            id: 'shop-1',
            settings: {
                businessInfo: {
                    shopName: 'Rina Fashion',
                    openingHours: '10am-8pm',
                    additionalInfo: 'Exchange requires an unboxing video.',
                    socialLinks: { website: 'https://rina.example' },
                },
            },
        };

        const res = await indexShop('shop-1');

        expect(res).toMatchObject({ errors: 0, indexed: 1, sourceCount: 1 });
        const { text, metadata } = mockIngest.mock.calls[0][0];
        expect(text).toContain('Business hours: 10am-8pm');
        expect(text).toContain('Additional shop owner info: Exchange requires an unboxing video.');
        expect(text).toContain('website: https://rina.example');
        expect(metadata).toMatchObject({ type: 'business_info', shopId: 'shop-1' });
    });
});
