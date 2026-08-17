'use strict';

process.env.NODE_ENV = 'test';
process.env.EMBEDDING_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'AIza-test';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.EMBEDDING_HTTP_MAX_RETRIES = '0';
process.env.QDRANT_FALLBACK_COLLECTION = 'knowledge_documents_openai';
delete process.env.QDRANT_PER_TENANT;

jest.mock('src/config/config', () => ({ env: 'test' }));

const {
    EMBEDDING_SPACE_MANIFEST_POINT_ID,
    createEmbeddingSpaceIdentity,
    createManifestPayload,
} = require('../embedding-space');

const geminiIdentity = createEmbeddingSpaceIdentity({
    provider: 'gemini',
    model: 'gemini-embedding-2',
    version: 'gemini-embedding-2-search-v1',
    dimensions: 384,
});
const openaiIdentity = createEmbeddingSpaceIdentity({
    provider: 'openai',
    model: 'text-embedding-3-small',
    version: 'openai-text-embedding-3-small-v1',
    dimensions: 384,
});

const calls = [];
const collectionFromUrl = (url) => decodeURIComponent(String(url).match(/\/collections\/([^/]+)/)?.[1] || '');
const manifestFor = (collection) => createManifestPayload({
    collection,
    identity: collection.includes('openai') ? openaiIdentity : geminiIdentity,
    state: collection.includes('openai') ? 'READY' : 'ACTIVE',
});

global.fetch = jest.fn(async (url) => {
    const endpoint = String(url);
    calls.push(endpoint);
    if (endpoint.includes('generativelanguage.googleapis.com')) {
        return { ok: false, status: 503, text: async () => 'Gemini unavailable' };
    }
    if (endpoint.includes('api.openai.com')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ embedding: new Array(384).fill(0.1) }] }),
        };
    }
    const collection = collectionFromUrl(endpoint);
    if (endpoint.includes('/points/scroll')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                result: {
                    points: [{
                        id: EMBEDDING_SPACE_MANIFEST_POINT_ID,
                        payload: manifestFor(collection),
                    }],
                },
            }),
        };
    }
    if (/\/collections\/[^/]+$/.test(endpoint)) {
        return {
            ok: true,
            status: 200,
            json: async () => ({ result: { config: { params: { vectors: { size: 384 } } } } }),
        };
    }
    if (endpoint.includes('/points/search')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({ result: [{ score: 0.9, payload: { text: 'fallback result', shopId: 'shop-1' } }] }),
        };
    }
    return { ok: true, status: 200, json: async () => ({ result: [] }) };
});

const rag = require('../rag.service');

describe('collection-level fallback routing', () => {
    test('Gemini query failure searches only the READY OpenAI collection', async () => {
        const result = await rag.queryData({ query: 'delivery', shopId: 'shop-1' });

        expect(result.success).toBe(true);
        expect(result.collection).toBe('knowledge_documents_openai');
        expect(result.embeddingSpace.provider).toBe('openai');
        expect(calls.some((url) => url.includes('/collections/knowledge_documents_openai/points/search')))
            .toBe(true);
        expect(calls.some((url) => url.includes('/collections/knowledge_documents/points/search')))
            .toBe(false);
    });
});
