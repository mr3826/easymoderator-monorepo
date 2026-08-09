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
});

describe('B — Bengali product-intent gate', () => {
    test('a pure Bengali-script price question reaches the live DB product search', async () => {
        productSearch.searchByAttributes.mockResolvedValue([{ id: 'p1', name: 'Cotton Panjabi', price: 1200 }]);

        await route({ shopId: SHOP, message: 'এই পাঞ্জাবির দাম কত?', systemPrompt: 'BASE' });

        expect(productSearch.searchByAttributes).toHaveBeenCalledWith(expect.objectContaining({ shopId: SHOP }));
        const sys = lastSystemPrompt();
        expect(sys).toContain('CATALOG EVIDENCE — verified products');
        expect(sys).toContain('৳1200');
        expect(sys).toContain('GROUNDING RULES');
    });

    test('a plain greeting does NOT trigger the product search', async () => {
        await route({ shopId: SHOP, message: 'hello', systemPrompt: 'BASE' });
        expect(productSearch.searchByAttributes).not.toHaveBeenCalled();
    });

    test('closed-set chatter does NOT trigger the product search', async () => {
        for (const msg of ['thanks', 'ok', 'ধন্যবাদ', 'thik ache', 'hmm']) {
            productSearch.searchByAttributes.mockClear();
            await route({ shopId: SHOP, message: msg, systemPrompt: 'BASE' });
            expect(productSearch.searchByAttributes).not.toHaveBeenCalled();
        }
    });

    // These carry no PRODUCT_INTENT_KEYWORDS token, so the old keyword gate
    // blocked them and they reached the LLM with no product grounding at all.
    test('product questions with no keyword still reach the live DB search', async () => {
        for (const msg of [
            'do you have the cotton jamdani saree',
            'what sarees do you have',
            'how much is the travel duffel bag',
            'soft cotton saree deluxe',
        ]) {
            productSearch.searchByAttributes.mockClear();
            await route({ shopId: SHOP, message: msg, systemPrompt: 'BASE' });
            expect(productSearch.searchByAttributes).toHaveBeenCalledWith(
                expect.objectContaining({ shopId: SHOP, query: msg }),
            );
        }
    });
});

describe('C — RAG product hit re-fetched live', () => {
    // The vector-store product tier only runs on a genuinely semantic embedder;
    // see 'F — non-semantic embedder' for the fallback behaviour.
    const productHit = {
        success: true,
        results: [{
            score: 0.78,
            content: 'Silk Saree | red | category: saree', // price-less embedding text
            metadata: { type: 'product', product_id: 'p-saree', shopId: SHOP, documentId: 'product:p-saree' },
        }],
    };

    beforeEach(() => { process.env.EMBEDDING_PROVIDER = 'openai'; });
    afterEach(() => { delete process.env.EMBEDDING_PROVIDER; });

    test('semantic product hit is re-fetched by product_id, never quoted from embedding text', async () => {
        rag.queryData.mockResolvedValue(productHit);
        productSearch.getProductsByIds.mockResolvedValue([{ id: 'p-saree', name: 'Red Silk Saree', price: 3200 }]);

        await route({ shopId: SHOP, message: 'red silk saree ache?', systemPrompt: 'BASE' });

        expect(productSearch.getProductsByIds).toHaveBeenCalledWith(['p-saree'], SHOP);
        const sys = lastSystemPrompt();
        // Live DB price, and the price-less embedding text is never knowledge.
        expect(sys).toContain('CATALOG EVIDENCE — verified products');
        expect(sys).toContain('৳3200');
        expect(sys).not.toContain('KNOWLEDGE BASE CONTEXT');
    });

    test('a vector hit alone does not make a product verified for a vague follow-up', async () => {
        rag.queryData.mockResolvedValue(productHit);
        productSearch.getProductsByIds.mockResolvedValue([{ id: 'p-saree', name: 'Red Silk Saree', price: 3200 }]);

        // "that one" identifies nothing. A 0.78 cosine against a vague sentence is
        // a search candidate, not proof that this is the product being discussed,
        // so its price must not become a quotable fact.
        const res = await route({ shopId: SHOP, message: 'tell me more about that one', systemPrompt: 'BASE' });

        expect(res.grounding.verifiedProducts).toHaveLength(0);
        expect(lastSystemPrompt()).not.toContain('৳3200');
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

// ---------------------------------------------------------------------------
// D — customer photo → product matching
//
// The dominant F-commerce inbox entry point: a product screenshot plus three
// words of Banglish. The photo reaches a model exactly once (the extraction
// call); the reply is generated from that description plus live catalog rows.
// ---------------------------------------------------------------------------
describe('D — customer photo → product matching', () => {
    const PHOTO = 'https://scontent.xx.fbcdn.net/first.jpg';
    const ATTRS = {
        category: 'saree',
        color: 'red',
        material: 'cotton',
        query: 'red cotton saree',
        tags: ['saree', 'red', 'cotton'],
        description: 'a red cotton saree with a printed floral border',
    };

    // The extraction call is the one carrying an image block; everything else is
    // the reply. Keyed on content shape rather than call index so a future extra
    // call cannot silently make these assertions vacuous.
    const imageCalls = () => llm.chat.mock.calls.filter(([a]) =>
        (a.messages || []).some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'image_url')));
    const imageBlocks = () => imageCalls().flatMap(([a]) =>
        a.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'image_url'));

    beforeEach(() => {
        delete process.env.AI_PHOTO_MATCH_ENABLED;
        delete process.env.AI_VISION_ENABLED;
        // Extraction returns JSON; the reply call returns prose.
        llm.chat.mockImplementation(async ({ systemPrompt }) =>
            /product image analyzer/i.test(systemPrompt || '')
                ? { text: JSON.stringify(ATTRS), provider: 'gemini' }
                : { text: 'Ji apa, eita ache.', provider: 'gemini' });
    });

    test('three photos in a burst cost exactly one image call, on the FIRST photo', async () => {
        await route({
            shopId: SHOP,
            message: 'eita ache?',
            systemPrompt: 'BASE',
            imageUrls: [PHOTO, 'https://scontent.xx.fbcdn.net/second.jpg', 'https://scontent.xx.fbcdn.net/third.jpg'],
        });

        const blocks = imageBlocks();
        expect(blocks).toHaveLength(1);
        expect(blocks[0].url).toBe(PHOTO);
        expect(JSON.stringify(llm.chat.mock.calls)).not.toContain('second.jpg');
        expect(JSON.stringify(llm.chat.mock.calls)).not.toContain('third.jpg');
    });

    test('the customer is told only the first of several photos was examined', async () => {
        await route({
            shopId: SHOP, message: 'eita ache?', systemPrompt: 'BASE',
            imageUrls: [PHOTO, 'https://scontent.xx.fbcdn.net/second.jpg'],
        });
        expect(lastSystemPrompt()).toContain('Only the first was examined');
    });

    test('a single photo adds no multi-photo note', async () => {
        await route({ shopId: SHOP, message: 'eita ache?', systemPrompt: 'BASE', imageUrls: [PHOTO] });
        expect(lastSystemPrompt()).not.toContain('Only the first was examined');
    });

    test('the reply call carries no image bytes — one image call per photo, not two', async () => {
        await route({ shopId: SHOP, message: 'dam koto?', systemPrompt: 'BASE', imageUrls: [PHOTO] });

        expect(imageCalls()).toHaveLength(1);
        const reply = llm.chat.mock.calls[llm.chat.mock.calls.length - 1][0];
        expect(JSON.stringify(reply.messages)).not.toContain('image_url');
        expect(JSON.stringify(reply.messages)).toContain('dam koto?');
    });

    test('extracted attributes drive the live catalog search', async () => {
        await route({ shopId: SHOP, message: 'eita ache?', systemPrompt: 'BASE', imageUrls: [PHOTO] });

        expect(productSearch.searchByAttributes).toHaveBeenCalledWith(expect.objectContaining({
            shopId: SHOP, category: 'saree', color: 'red', material: 'cotton', tags: ATTRS.tags,
        }));
    });

    test('a match grounds the reply on live DB facts and records the source', async () => {
        productSearch.searchByAttributes.mockResolvedValue([{ id: 'p9', name: 'Red Cotton Saree', price: 2500 }]);

        const res = await route({ shopId: SHOP, message: 'dam koto?', systemPrompt: 'BASE', imageUrls: [PHOTO] });

        const sys = lastSystemPrompt();
        expect(sys).toContain('CATALOG EVIDENCE — verified products');
        expect(sys).toContain('৳2500');
        expect(sys).toContain('Never invent or infer one');
        expect(res.sourceReferences).toEqual([{ kind: 'product', id: 'p9', title: 'Red Cotton Saree' }]);
    });

    test('the photo description is passed forward so the text-only reply can discuss it', async () => {
        await route({ shopId: SHOP, message: 'eita ache?', systemPrompt: 'BASE', imageUrls: [PHOTO] });

        const sys = lastSystemPrompt();
        expect(sys).toContain('printed floral border');
        expect(sys).toContain('You did not see the photo yourself');
    });

    test('no catalog match tells the customer plainly and asks for more detail', async () => {
        productSearch.searchByAttributes.mockResolvedValue([]);

        await route({ shopId: SHOP, message: 'eita ache?', systemPrompt: 'BASE', imageUrls: [PHOTO] });

        const sys = lastSystemPrompt();
        expect(sys).toContain('NO product in this shop');
        expect(sys).toContain('could not find it');
        // The photo describes what the CUSTOMER sent, never this shop's stock.
        expect(sys).toContain('not a product this shop sells');
    });

    test('a failed extraction still reaches the model grounded, never on the bare prompt', async () => {
        llm.chat.mockImplementation(async ({ systemPrompt }) =>
            /product image analyzer/i.test(systemPrompt || '')
                ? { text: 'sorry, I cannot do that', provider: 'gemini' }   // unparseable → attrs null
                : { text: 'reply', provider: 'gemini' });

        await route({ shopId: SHOP, message: 'eita ache?', systemPrompt: 'BASE', imageUrls: [PHOTO] });

        const sys = lastSystemPrompt();
        expect(sys).not.toBe('BASE');
        expect(sys).toContain('NO product in this shop');
    });

    test('a caption-less photo still gets a grounding note', async () => {
        productSearch.searchByAttributes.mockResolvedValue([]);

        await route({ shopId: SHOP, message: '[image]', systemPrompt: 'BASE', imageUrls: [PHOTO] });

        expect(lastSystemPrompt()).toContain('NO product in this shop');
    });

    test('AI_PHOTO_MATCH_ENABLED=false skips the image call and admits it cannot see', async () => {
        process.env.AI_PHOTO_MATCH_ENABLED = 'false';

        await route({ shopId: SHOP, message: 'eita ache?', systemPrompt: 'BASE', imageUrls: [PHOTO] });

        expect(imageCalls()).toHaveLength(0);
        expect(productSearch.searchByAttributes).toHaveBeenCalledWith(
            expect.objectContaining({ query: 'eita ache?' }));
        expect(lastSystemPrompt()).toContain('CANNOT see images');
    });
});
