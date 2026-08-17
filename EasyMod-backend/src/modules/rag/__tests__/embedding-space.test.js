'use strict';

const {
    EMBEDDING_SPACE_STATES,
    assertEmbeddingSpaceCompatible,
    assertStateTransition,
    createEmbeddingSpaceIdentity,
    createManifestPayload,
    identityFromPayload,
    isQueryableState,
    isWritableState,
    sameEmbeddingSpace,
} = require('../embedding-space');

const base = () => createEmbeddingSpaceIdentity({
    provider: 'gemini',
    model: 'gemini-embedding-2',
    version: 'gemini-embedding-2-search-v1',
    dimensions: 384,
});

describe('provider-bound embedding-space identity', () => {
    test('same provider/model/version/dimensions are compatible', () => {
        expect(sameEmbeddingSpace(base(), base())).toBe(true);
        expect(() => assertEmbeddingSpaceCompatible(base(), base())).not.toThrow();
    });

    test.each([
        ['provider', { provider: 'openai' }],
        ['model', { model: 'other-model' }],
        ['version', { version: 'gemini-embedding-2-search-v2' }],
        ['dimensions', { dimensions: 768 }],
    ])('different %s is rejected before a vector can cross spaces', (_field, override) => {
        const other = base();
        const changed = createEmbeddingSpaceIdentity({
            provider: override.provider || other.provider,
            model: override.model || other.model,
            version: override.version || other.embedding_space_version,
            dimensions: override.dimensions || other.dimensions,
        });
        expect(sameEmbeddingSpace(base(), changed)).toBe(false);
        expect(() => assertEmbeddingSpaceCompatible(base(), changed))
            .toThrow(expect.objectContaining({ code: 'EMBEDDING_SPACE_MISMATCH' }));
    });

    test('identity is durable in a manifest payload and round-trips exactly', () => {
        const identity = base();
        const payload = createManifestPayload({
            collection: 'knowledge_documents_gemini_run',
            identity,
            state: EMBEDDING_SPACE_STATES.BUILDING,
        });
        expect(identityFromPayload(payload)).toEqual(identity);
        expect(payload.embedding_collection_state).toBe('BUILDING');
    });

    test('queryable and writable states fail closed', () => {
        expect(isWritableState('BUILDING')).toBe(true);
        expect(isWritableState('FAILED')).toBe(false);
        expect(isQueryableState('READY')).toBe(true);
        expect(isQueryableState('BUILDING')).toBe(false);
        expect(() => assertStateTransition('BUILDING', 'READY')).toThrow();
        expect(() => assertStateTransition('VALIDATING', 'READY')).not.toThrow();
    });
});
