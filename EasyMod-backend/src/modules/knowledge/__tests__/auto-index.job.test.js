'use strict';

/**
 * Regression tests for the knowledge auto-index job (used by the Qdrant reindex
 * CLI). Guards two field/schema bugs found during the 2026-05-31 prod reindex:
 *   1. FAQs are stored as category + template_bn/template_en (no question/answer
 *      columns) — the job must embed those, not `undefined`.
 *   2. Custom docs live in `knowledge_documents`, not `shop_knowledge_documents`.
 */

process.env.NODE_ENV = 'test';

jest.mock('src/utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const mockIngest = jest.fn(() => Promise.resolve({ success: true }));
jest.mock('src/modules/rag/rag.service', () => ({ ingestData: (...a) => mockIngest(...a) }));

const mockQuery = jest.fn(() => Promise.resolve([[]]));
jest.mock('src/utils/database/database-setup', () => ({ sequelize: { query: (...a) => mockQuery(...a) } }));

const mockShopFindByPk = jest.fn();
const mockFaqFindAll = jest.fn(() => Promise.resolve([]));
jest.mock('src/modules/entities', () => ({
    Shop: { findByPk: (...a) => mockShopFindByPk(...a) },
    FaqResponse: { findAll: (...a) => mockFaqFindAll(...a) },
}));

const { indexShop } = require('src/modules/knowledge/auto-index.job');

describe('auto-index.job — indexShop', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockShopFindByPk.mockResolvedValue(null);   // no business info
        mockFaqFindAll.mockResolvedValue([]);        // no FAQs
        mockQuery.mockResolvedValue([[]]);           // no products / docs
    });

    it('embeds FAQ category + bilingual templates (never undefined question/answer)', async () => {
        mockFaqFindAll.mockResolvedValue([
            { id: 7, category: 'ডেলিভারি চার্জ', template_bn: 'ঢাকায় ৬০৳', template_en: 'Dhaka 60 BDT' },
        ]);

        const res = await indexShop('shop-1');

        expect(res.errors).toBe(0);
        expect(res.indexed).toBe(1);
        expect(mockFaqFindAll).toHaveBeenCalledWith({ where: { shop_id: 'shop-1', is_active: true } });

        const { text, metadata } = mockIngest.mock.calls[0][0];
        expect(text).toContain('Q: ডেলিভারি চার্জ');
        expect(text).toContain('A (BN): ঢাকায় ৬০৳');
        expect(text).toContain('A (EN): Dhaka 60 BDT');
        expect(text).not.toContain('undefined');
        expect(metadata.type).toBe('faq');
        expect(metadata.shopId).toBe('shop-1');
    });

    it('queries knowledge_documents, never shop_knowledge_documents', async () => {
        await indexShop('shop-1');

        const sqls = mockQuery.mock.calls.map((c) => c[0]);
        expect(sqls.some((s) => /\bknowledge_documents\b/.test(s) && !/shop_knowledge_documents/.test(s))).toBe(true);
        expect(sqls.some((s) => /shop_knowledge_documents/.test(s))).toBe(false);
    });

    it('counts a swallowed ingest failure as an error, not a silent success', async () => {
        mockFaqFindAll.mockResolvedValue([
            { id: 1, category: 'COD', template_bn: 'ক্যাশ অন ডেলিভারি', template_en: 'Cash on delivery' },
        ]);
        mockIngest.mockResolvedValueOnce({ success: false, message: 'RAG service unavailable' });

        const res = await indexShop('shop-1');

        expect(res.indexed).toBe(0);
        expect(res.errors).toBe(1);
    });

    it('indexes additional owner business info and openingHours', async () => {
        mockShopFindByPk.mockResolvedValue({
            settings: {
                businessInfo: {
                    shopName: 'Rina Fashion',
                    openingHours: '10am-8pm',
                    additionalInfo: 'Exchange requires an unboxing video.',
                    socialLinks: { website: 'https://rina.example' },
                },
            },
        });

        const res = await indexShop('shop-1');

        expect(res.errors).toBe(0);
        expect(res.indexed).toBe(1);
        const { text, metadata } = mockIngest.mock.calls[0][0];
        expect(text).toContain('Business hours: 10am-8pm');
        expect(text).toContain('Additional shop owner info: Exchange requires an unboxing video.');
        expect(text).toContain('website: https://rina.example');
        expect(metadata.type).toBe('business_info');
    });
});
