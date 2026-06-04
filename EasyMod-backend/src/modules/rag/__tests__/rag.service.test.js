'use strict';

/**
 * rag.service — Qdrant point-ID normalization.
 *
 * Qdrant only accepts unsigned-int or UUID point IDs. Product/knowledge code
 * passes human-readable documentIds ("product:<uuid>", "faq-42", "biz-<shopId>")
 * which Qdrant rejects with a 400 — and ingestData swallows that, so the upsert
 * silently never lands. These tests lock in the deterministic UUIDv5 mapping
 * that makes those upserts valid (and keeps deletes targeting the same point).
 */

process.env.NODE_ENV = 'test';
process.env.EMBEDDING_PROVIDER = 'local';
delete process.env.QDRANT_PER_TENANT;

jest.mock('src/config/config', () => ({ env: 'test' }));

const { validate: uuidValidate } = require('uuid');

const calls = [];
global.fetch = jest.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    // All Qdrant calls "succeed": GET collection (exists), PUT upsert, POST delete.
    return { ok: true, status: 200, text: async () => '', json: async () => ({ result: [] }) };
});

const rag = require('src/modules/rag/rag.service');

const upsertBody = () => {
    const c = calls.find(x => x.url.includes('/points?wait=true'));
    return c ? JSON.parse(c.init.body) : null;
};

beforeEach(() => { calls.length = 0; });

describe('Qdrant point-id normalization', () => {
    test('a non-UUID documentId is upserted under a valid UUID', async () => {
        const res = await rag.ingestData({
            text: 'Blue Cotton Shirt',
            metadata: { documentId: 'product:abc-123', shopId: 's1', type: 'product', product_id: 'abc-123' }
        });
        expect(res.success).toBe(true);

        const body = upsertBody();
        expect(body).toBeTruthy();
        const point = body.points[0];
        expect(uuidValidate(point.id)).toBe(true);
        // The human-readable documentId + product_id survive in the payload so
        // source references and live re-fetch (product_id) still work.
        expect(point.payload.documentId).toBe('product:abc-123');
        expect(point.payload.product_id).toBe('abc-123');
    });

    test('the same documentId is deterministic, and delete targets that exact point', async () => {
        await rag.ingestData({ text: 'a', metadata: { documentId: 'faq-42', shopId: 's1' } });
        const upsertId = upsertBody().points[0].id;

        calls.length = 0;
        await rag.deletePoint('faq-42', 's1');
        const delCall = calls.find(c => c.url.includes('/points/delete'));
        const delBody = JSON.parse(delCall.init.body);
        expect(delBody.points[0]).toBe(upsertId);
    });

    test('an already-valid UUID documentId is preserved unchanged', async () => {
        const uuid = '11111111-2222-4333-8444-555555555555';
        await rag.ingestData({ text: 'x', metadata: { documentId: uuid, shopId: 's1' } });
        expect(upsertBody().points[0].id).toBe(uuid);
    });
});
