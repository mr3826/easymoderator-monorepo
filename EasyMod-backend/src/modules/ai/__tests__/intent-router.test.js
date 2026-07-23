'use strict';

/**
 * intent-router.route() — product grounding paths.
 *
 * Verifies the two fixes that stop the chatbot from hallucinating prices:
 *   B. Bengali-script price questions reach the live DB product search.
 *   C. A product matched semantically (vector store) is re-fetched LIVE by
 *      product_id (so price comes from the DB), and its price-less embedding
 *      text is NOT dumped as knowledge ground-truth.
 *
 * All collaborators are mocked so this is a fast, deterministic unit test
 * (unlike the heavy, CI-excluded chatbot-rag integration suite).
 */

process.env.NODE_ENV = 'test';

jest.mock('src/config/memory-cache', () => ({
    MemoryCache: class { async get() { return null; } async setex() { return 'OK'; } }
}));
jest.mock('src/modules/ai/llm.service', () => ({ chat: jest.fn() }));
jest.mock('src/modules/ai/bert-client.service', () => ({ classify: jest.fn(async () => null) }));
jest.mock('src/modules/ai/gemini-cache.service', () => ({ getOrCreate: jest.fn(async () => null) }));
jest.mock('src/modules/ai/prompt-sanitizer.service', () => ({ scrubPII: (x) => x }));
jest.mock('src/modules/knowledge/knowledge.service', () => ({ incrementFaqHit: jest.fn() }));
jest.mock('src/modules/product/product-search.service', () => ({
    searchByAttributes: jest.fn(),
    getProductsByIds: jest.fn(),
    formatProductsForLlm: jest.fn(),
}));
jest.mock('src/modules/rag/rag.service', () => ({ queryData: jest.fn() }));
jest.mock('src/modules/entities', () => ({
    Order: { findOne: jest.fn(async () => null) },
    FaqResponse: { findAll: jest.fn(async () => []) },
}));

const { route } = require('src/modules/ai/intent-router.service');
const llm = require('src/modules/ai/llm.service');
const productSearch = require('src/modules/product/product-search.service');
const rag = require('src/modules/rag/rag.service');

const SHOP = 'shop-1';
const lastSystemPrompt = () => {
    const calls = llm.chat.mock.calls;
    return calls.length ? calls[calls.length - 1][0].systemPrompt : null;
};

beforeEach(() => {
    jest.clearAllMocks();
    llm.chat.mockResolvedValue({ text: 'ok', provider: 'gemini' });
    rag.queryData.mockResolvedValue({ results: [] });
    productSearch.searchByAttributes.mockResolvedValue([]);
    productSearch.getProductsByIds.mockResolvedValue([]);
    productSearch.formatProductsForLlm.mockImplementation((ps) =>
        ps.map((p) => `1. ${p.name}\n   Price: ৳${p.price}\n   Status: IN STOCK`).join('\n\n'));
});

describe('B — Bengali product-intent gate', () => {
    test('a pure Bengali-script price question reaches the live DB product search', async () => {
        productSearch.searchByAttributes.mockResolvedValue([{ id: 'p1', name: 'Cotton Panjabi', price: 1200 }]);

        await route({ shopId: SHOP, message: 'এই পাঞ্জাবির দাম কত?', systemPrompt: 'BASE' });

        expect(productSearch.searchByAttributes).toHaveBeenCalledWith(expect.objectContaining({ shopId: SHOP }));
        const sys = lastSystemPrompt();
        expect(sys).toContain('RELEVANT SHOP PRODUCTS');
        expect(sys).toContain('৳1200');
        expect(sys).toContain('GROUNDING RULES');
    });

    test('a plain greeting does NOT trigger the product search', async () => {
        await route({ shopId: SHOP, message: 'hello', systemPrompt: 'BASE' });
        expect(productSearch.searchByAttributes).not.toHaveBeenCalled();
    });
});

describe('C — RAG product hit re-fetched live', () => {
    test('semantic product hit is re-fetched by product_id; price comes from DB, not embedding text', async () => {
        rag.queryData.mockResolvedValue({
            success: true,
            results: [{
                score: 0.78,
                content: 'Silk Saree | red | category: saree', // price-less embedding text
                metadata: { type: 'product', product_id: 'p-saree', shopId: SHOP, documentId: 'product:p-saree' },
            }],
        });
        productSearch.getProductsByIds.mockResolvedValue([{ id: 'p-saree', name: 'Red Silk Saree', price: 3200 }]);

        // No product-intent keyword → the DB product-search branch is skipped;
        // only the RAG enrichment path runs.
        await route({ shopId: SHOP, message: 'tell me more about that one', systemPrompt: 'BASE' });

        expect(productSearch.searchByAttributes).not.toHaveBeenCalled();
        expect(productSearch.getProductsByIds).toHaveBeenCalledWith(['p-saree'], SHOP);
        const sys = lastSystemPrompt();
        expect(sys).toContain('RELEVANT SHOP PRODUCTS');
        expect(sys).toContain('৳3200');
        // The price-less product embedding text must NOT be injected as knowledge.
        expect(sys).not.toContain('KNOWLEDGE BASE CONTEXT');
    });

    test('a non-product knowledge hit is still injected as KNOWLEDGE BASE CONTEXT', async () => {
        rag.queryData.mockResolvedValue({
            success: true,
            results: [{
                score: 0.9,
                content: 'We deliver to Dhaka in 1-2 days.',
                metadata: { type: 'faq', documentId: 'faq-7', shopId: SHOP },
            }],
        });

        await route({ shopId: SHOP, message: 'tell me about delivery time', systemPrompt: 'BASE' });

        expect(productSearch.getProductsByIds).not.toHaveBeenCalled();
        const sys = lastSystemPrompt();
        expect(sys).toContain('KNOWLEDGE BASE CONTEXT');
        expect(sys).toContain('We deliver to Dhaka');
    });

    test('business_info vector hits are ignored because business info is injected live', async () => {
        rag.queryData.mockResolvedValue({
            success: true,
            results: [{
                score: 0.92,
                content: 'Phone: 017-old-stale',
                metadata: { type: 'business_info', documentId: 'biz-shop-1', shopId: SHOP },
            }],
        });

        await route({
            shopId: SHOP,
            message: 'What is your phone number?',
            systemPrompt: 'Phone: 018-live-current',
        });

        const sys = lastSystemPrompt();
        expect(sys).toContain('018-live-current');
        expect(sys).not.toContain('017-old-stale');
        expect(sys).not.toContain('KNOWLEDGE BASE CONTEXT');
    });
});
