'use strict';

/**
 * Retrieval behaviour: the product-search filter contract and the text-derived
 * search metadata that replaced vision-derived attributes.
 *
 * The end-to-end accuracy numbers live in scripts/retrieval-eval/run-eval.js,
 * which needs a Postgres instance. These are the cheap always-on guards for the
 * two defects that harness found, so a regression fails in normal CI too.
 */

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');

const SEARCH_SRC = fs.readFileSync(
    path.resolve(__dirname, '../product-search.service.js'), 'utf8',
);

describe('product-search WHERE clause is a filter, not a tautology', () => {
    // buildQueryReplacements turns an absent filter into '%%', and in Postgres
    // 'anything' ILIKE '%%' is TRUE. Any wildcard comparison that is not gated on
    // the parameter being non-empty therefore matches the entire catalogue, and a
    // free-text query stops filtering at all — the chatbot then grounds its reply
    // on five arbitrary products. Verified against Postgres 16 in the eval harness.
    const whereClause = SEARCH_SRC
        .slice(SEARCH_SRC.indexOf('    WHERE'), SEARCH_SRC.indexOf('ORDER BY relevance'));

    test('every wildcard ILIKE in the WHERE clause is gated on a non-empty parameter', () => {
        const ungated = whereClause
            .split('\n')
            .filter((line) => /ILIKE\s+:\w+Wild/.test(line))
            .filter((line) => !/:\w+\s*!=\s*''/.test(line));

        expect(ungated).toEqual([]);
    });

    test('the wildcard replacements really do collapse to the match-all pattern', () => {
        // Guards the assumption the test above rests on: if this ever stops being
        // '%%', the gating requirement needs rethinking rather than silently passing.
        expect(SEARCH_SRC).toContain("categoryWild: `%${category || ''}%`");
    });

    test('searchForOrder never falls back to an arbitrary product', () => {
        expect(SEARCH_SRC).toContain('return { products: [], wasFallback: true };');
    });
});

describe('text-derived search attributes (no vision)', () => {
    jest.mock('src/modules/product/product.entity', () => ({ findOne: jest.fn(), findAll: jest.fn() }));
    jest.mock('src/modules/product/product-embedding.service', () => ({ embedProduct: jest.fn() }));
    jest.mock('src/modules/product/clip-client.service', () => ({
        indexProductImage: jest.fn(), removeProductIndex: jest.fn(),
    }));
    jest.mock('src/modules/ai/llm.service', () => ({ chat: jest.fn() }));

    const { deriveAttributesFromText } = require('src/modules/product/product-ai.service');

    test('category, colour and material come from the record, not a model', () => {
        const attrs = deriveAttributesFromText({
            name: 'Cotton Jamdani Saree',
            name_bn: 'কটন জামদানি শাড়ি',
            category: 'Saree',
            description: 'Soft cotton jamdani woven in Tangail.',
            tags: ['saree', 'eid-collection'],
            variants: [{ option: 'Color', value: 'Maroon' }, { size: 'M', option: 'Size', value: 'M' }],
        });

        expect(attrs.category).toBe('Saree');
        expect(attrs.color_primary).toBe('Maroon');
        expect(attrs.material).toBe('cotton');
        expect(attrs.search_text).toContain('জামদানি');
        expect(attrs.search_text).toContain('tangail');
    });

    test('colour is null rather than guessed when nothing states it', () => {
        // ai_color_primary scores 3 points in the search ranking, so a wrong
        // colour actively demotes the right product. Null is the safe answer.
        const attrs = deriveAttributesFromText({
            name: 'Kabli Set', category: 'Panjabi', description: 'Two piece kabli set.',
            tags: [], variants: [],
        });
        expect(attrs.color_primary).toBeNull();
    });

    test('a product with no image still yields full search text', () => {
        const attrs = deriveAttributesFromText({
            name: 'Jute Tote Bag', name_bn: 'জুট টোট ব্যাগ', category: 'Bag',
            description: 'Eco-friendly jute tote.', tags: ['bag'], variants: [],
        });
        expect(attrs.search_text).toContain('jute tote bag');
        expect(attrs.category).toBe('Bag');
        expect(attrs.material).toBe('jute');
    });

    test('a Bengali-only colour word is picked up from the name', () => {
        const attrs = deriveAttributesFromText({
            name: 'Black Georgette Kurti', category: 'Kurti',
            description: 'Black georgette kurti.', tags: [], variants: [],
        });
        expect(attrs.color_primary).toBe('black');
        expect(attrs.material).toBe('georgette');
    });
});

describe('vector-store product grounding requires a semantic embedder', () => {
    const ROUTER_SRC = fs.readFileSync(
        path.resolve(__dirname, '../../ai/intent-router.service.js'), 'utf8',
    );

    test('the RAG product tier is gated on embeddingSemantic()', () => {
        expect(ROUTER_SRC).toContain('const semanticEmbeddings = embeddingSemantic();');
        // Vector product hits are collected only when the embedder is genuinely
        // semantic; on the n-gram fallback they are dropped before they can
        // become candidates. (See grounding-boundary.test.js for the behavioural
        // assertion that a vector hit alone never verifies a product.)
        expect(ROUTER_SRC).toContain('if (semanticEmbeddings) productIds.push(String(md.product_id));');
    });

    test('the local n-gram fallback is not classed as semantic', () => {
        const { getProviderInfo } = require('src/modules/rag/embedding.service');
        const prev = process.env.EMBEDDING_PROVIDER;

        delete process.env.EMBEDDING_PROVIDER;
        expect(getProviderInfo().semantic).toBe(false);

        // The values every repo artefact suggests for Gemini embeddings are NOT
        // accepted by resolveProvider, so they silently degrade to the hash.
        for (const value of ['gemini', 'google', 'anthropic', 'lcoal']) {
            process.env.EMBEDDING_PROVIDER = value;
            expect(getProviderInfo().semantic).toBe(false);
        }

        for (const value of ['openai', 'gcp', 'http', 'tei']) {
            process.env.EMBEDDING_PROVIDER = value;
            expect(getProviderInfo().semantic).toBe(true);
        }

        if (prev === undefined) delete process.env.EMBEDDING_PROVIDER;
        else process.env.EMBEDDING_PROVIDER = prev;
    });
});
