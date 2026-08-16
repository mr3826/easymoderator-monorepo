'use strict';

// These tests exercise pure safety helpers; the production script loads pg for
// its remote source-count check, which is intentionally outside this unit test.
jest.mock('pg', () => ({ Client: jest.fn() }), { virtual: true });

const {
    assertSafeCollectionName,
    extractVectorSize,
    hasLexicalOverlap,
} = require('../qdrant-migration-proof');

describe('Qdrant migration proof safety helpers', () => {
    it('rejects the live collection and mutable or unsafe targets', () => {
        expect(() => assertSafeCollectionName('knowledge_documents')).toThrow();
        expect(() => assertSafeCollectionName('knowledge_documents_openai_rollback_20260816')).not.toThrow();
        expect(() => assertSafeCollectionName('knowledge_documents:latest')).toThrow();
        expect(() => assertSafeCollectionName('../knowledge_documents')).toThrow();
    });

    it('extracts vector size from single and named Qdrant vector configs', () => {
        expect(extractVectorSize({ config: { params: { vectors: { size: 384 } } } })).toBe(384);
        expect(extractVectorSize({ config: { params: { vectors: { default: { size: 768 } } } } })).toBe(768);
        expect(extractVectorSize({ config: { params: { vectors: { text: { size: 1536 } } } } })).toBe(1536);
        expect(extractVectorSize({})).toBeNull();
    });

    it('detects negative-query lexical overlap without treating unrelated text as a hit', () => {
        expect(hasLexicalOverlap('delivery charge', 'Delivery charge is 80 BDT')).toBe(true);
        expect(hasLexicalOverlap('quantum physics', 'Cotton saree delivery information')).toBe(false);
    });
});
