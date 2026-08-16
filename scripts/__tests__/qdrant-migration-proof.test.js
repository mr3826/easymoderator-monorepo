'use strict';

const fs = require('fs');
const path = require('path');

// These tests exercise pure safety helpers and verify that source-count reads are
// delegated to the shared PostgreSQL contract rather than hand-written against a
// Qdrant collection name.
jest.mock('pg', () => ({ Client: jest.fn() }), { virtual: true });

const {
    assertSafeCollectionName,
    extractVectorSize,
    hasLexicalOverlap,
    sourceStats,
    normalizeDatabaseUrl,
    normalizeQdrantUrl,
} = require('../qdrant-migration-proof');
const { Client } = require('pg');
const QDRANT_WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/qdrant-migration.yml');

describe('Qdrant migration proof safety helpers', () => {
    describe('URL contract', () => {
        it('accepts an HTTP Qdrant service URL', () => {
            expect(normalizeQdrantUrl('http://qdrant:6333')).toBe('http://qdrant:6333');
        });

        it('accepts an HTTPS Qdrant service URL', () => {
            expect(normalizeQdrantUrl('https://qdrant.internal:6333')).toBe('https://qdrant.internal:6333');
        });

        it('trims surrounding whitespace without accepting internal whitespace', () => {
            expect(normalizeQdrantUrl('  http://qdrant:6333/  ')).toBe('http://qdrant:6333');
            expect(() => normalizeQdrantUrl('http://qdrant: 6333')).toThrow(/whitespace/);
        });

        it('removes accidental literal surrounding quotes from rendered values', () => {
            expect(normalizeQdrantUrl('"http://qdrant:6333"')).toBe('http://qdrant:6333');
            expect(normalizeDatabaseUrl('"postgresql://user:pass@postgres:5432/easymod"'))
                .toBe('postgresql://user:pass@postgres:5432/easymod');
        });

        it('accepts a Docker service hostname with an explicit port', () => {
            expect(normalizeQdrantUrl('http://qdrant:6333')).toBe('http://qdrant:6333');
        });

        it('rejects malformed, unsupported, and missing URLs without exposing their values', () => {
            expect(() => normalizeQdrantUrl('http://http://qdrant:6333')).toThrow(/server-root/);
            expect(() => normalizeQdrantUrl('qdrant:6333')).toThrow(/allowed URL protocol/);
            expect(() => normalizeQdrantUrl('"http://qdrant:6333')).toThrow(/malformed surrounding quotes/);
            expect(() => normalizeQdrantUrl('')).toThrow(/QDRANT_URL is required/);
        });
    });

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

    it('delegates source counting to the shared PostgreSQL contract', async () => {
        const client = {
            connect: jest.fn().mockResolvedValue(undefined),
            end: jest.fn().mockResolvedValue(undefined),
            query: jest.fn(),
        };
        Client.mockImplementation(() => client);
        process.env.DATABASE_URL = 'postgres://proof-test';

        const collectSourceStats = jest.fn().mockResolvedValue({
            count: 2,
            shopIds: ['shop-1'],
            snippets: ['source one', 'source two'],
        });

        await expect(sourceStats({ sourceContract: { collectSourceStats } })).resolves.toEqual({
            count: 2,
            shopIds: ['shop-1'],
            snippets: ['source one', 'source two'],
        });
        expect(collectSourceStats).toHaveBeenCalledWith(expect.any(Function));
        expect(client.connect).toHaveBeenCalledTimes(1);
        expect(client.end).toHaveBeenCalledTimes(1);
    });

    it('proves Gemini primary, OpenAI fallback, and provider-compatible dimensions', () => {
        const workflow = fs.readFileSync(QDRANT_WORKFLOW_PATH, 'utf8');

        expect(workflow).toContain('OPENAI_FALLBACK_MODEL=text-embedding-3-small');
        expect(workflow).toContain('GEMINI_MODEL="${GEMINI_EMBEDDING_MODEL:-gemini-embedding-2}"');
        expect(workflow).toContain('run_provider_fallback');
        expect(workflow).toContain('provider-fallback');
        expect(workflow.indexOf('run_reindex gemini')).toBeLessThan(workflow.indexOf('run_reindex openai'));
        expect(workflow).toMatch(
            /run_reindex openai \"\$OPENAI_FALLBACK_MODEL\" \"\$GEMINI_MODEL\"/,
        );
        expect(workflow).toMatch(
            /run_provider_proof openai \"\$OPENAI_FALLBACK_MODEL\" \"\$GEMINI_MODEL\"/,
        );
        expect(workflow).toContain('QDRANT_VECTOR_COMPATIBILITY=PASS');
        expect(workflow).toContain('OPENAI_ROLLBACK_COLLECTION="${OPENAI_ROLLBACK_COLLECTION_BASE}_${WORKFLOW_RUN_ID}"');
        expect(workflow).not.toContain('text-embedding-004');
        expect(workflow).not.toMatch(/docker (?:rm|compose .*rm).*knowledge_documents/);
        expect(workflow).toContain('PRODUCTION_DEPLOY_ENABLED:-false');
    });
});
