'use strict';

jest.mock('@qdrant/qdrant-js', () => ({
    QdrantClient: jest.fn(() => ({})),
}));

const DeliveryRAGService = require('../delivery-rag.service');
const { createEmbeddingSpaceIdentity } = require('../../rag/embedding-space');

describe('delivery RAG embedding-space guard', () => {
    test('delivery collections use an explicitly separate local identity', () => {
        const service = new DeliveryRAGService();
        expect(service.embeddingIdentity).toMatchObject({
            provider: 'local',
            model: 'delivery-zone-hash',
            embedding_space_version: 'delivery-zone-hash-v1',
            dimensions: 384,
        });
        expect(service.contentFilter({ must: [{ key: 'shop_id', match: { value: 'shop-1' } }] }))
            .toMatchObject({ must: [{ key: 'shop_id' }] });
    });

    test('vectors from another provider space are rejected before use', () => {
        const service = new DeliveryRAGService();
        const openaiIdentity = createEmbeddingSpaceIdentity({
            provider: 'openai',
            model: 'text-embedding-3-small',
            version: 'openai-v1',
            dimensions: 384,
        });
        expect(() => service.assertBoundVector({ identity: openaiIdentity }, new Array(384).fill(0.1)))
            .toThrow(expect.objectContaining({ code: 'EMBEDDING_SPACE_MISMATCH' }));
        expect(() => service.assertBoundVector({ identity: service.embeddingIdentity }, new Array(12).fill(0.1)))
            .toThrow(/dimension mismatch/);
    });
});
