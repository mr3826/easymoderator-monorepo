'use strict';

const fs = require('fs');
const path = require('path');

// These tests exercise pure safety helpers and verify that source-count reads are
// delegated to the shared PostgreSQL contract rather than hand-written against a
// Qdrant collection name.
jest.mock('pg', () => ({ Client: jest.fn() }), { virtual: true });

const {
    assertSafeCollectionName,
    assertNegativeFixtureLexicallyDisjoint,
    extractVectorSize,
    hasLexicalOverlap,
    negativeSearchPass,
    NEGATIVE_SEARCH_QUERY,
    sourceStats,
    normalizeDatabaseUrl,
    normalizeQdrantUrl,
} = require('../qdrant-migration-proof');
const { Client } = require('pg');
const REPO_ROOT = path.resolve(__dirname, '../..');
const QDRANT_WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/qdrant-migration.yml');
const PROOF_SCRIPT_PATH = path.resolve(__dirname, '../qdrant-migration-proof.js');

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

    it('detects lexical overlap using the proof tokenizer', () => {
        expect(hasLexicalOverlap('delivery charge', 'Delivery charge is 80 BDT')).toBe(true);
        expect(hasLexicalOverlap('quantum physics', 'Cotton saree delivery information')).toBe(false);
    });

    it('accepts a negative fixture only when its score and lexical checks both pass', () => {
        const point = { score: 0.49, payload: { text: 'Cotton saree delivery information' } };

        expect(negativeSearchPass(point, NEGATIVE_SEARCH_QUERY, 0.5)).toBe(true);
        expect(negativeSearchPass(null, NEGATIVE_SEARCH_QUERY, 0.5)).toBe(true);
    });

    it('fails the fixture invariant clearly when a normalized token overlaps a source', () => {
        const sourceId = 'customer-source-42';
        let error;

        try {
            assertNegativeFixtureLexicallyDisjoint(
                'quantum physics black hole laboratory',
                [{ id: sourceId, payload: { documentId: sourceId, text: 'FAQ about physics delivery' } }],
            );
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/negative fixture lexical overlap/);
        expect(error.message).toContain('tokens=physics');
        expect(error.message).toContain('source_hash=');
        expect(error.message).not.toContain(sourceId);
        expect(negativeSearchPass(
            { score: 0.49, payload: { text: 'FAQ about physics delivery' } },
            'quantum physics black hole laboratory',
            0.5,
        )).toBe(false);
    });

    it('keeps a valid negative fixture lexically disjoint from every indexed point', () => {
        expect(() => assertNegativeFixtureLexicallyDisjoint(
            NEGATIVE_SEARCH_QUERY,
            [
                { id: 'faq-1', payload: { documentId: 'faq-1', text: 'Cotton saree delivery information' } },
                { id: 'product-1', payload: { documentId: 'product-1', text: 'Blue cotton saree, available in Dhaka' } },
            ],
        )).not.toThrow();
    });

    it('fails negative search on a true semantic false positive at the threshold', () => {
        expect(negativeSearchPass(
            { score: 0.5, payload: { text: 'unrelated proof content' } },
            NEGATIVE_SEARCH_QUERY,
            0.5,
        )).toBe(false);
        expect(negativeSearchPass(
            { score: 0.72, payload: { text: 'unrelated proof content' } },
            NEGATIVE_SEARCH_QUERY,
            0.5,
        )).toBe(false);
    });

    it('keeps positive-language and tenant-isolation gates wired into validation', () => {
        const proof = fs.readFileSync(PROOF_SCRIPT_PATH, 'utf8');

        expect(proof).toContain('const banglaPass = await runPositive(banglaQuery);');
        expect(proof).toContain('const englishPass = await runPositive(englishQuery);');
        expect(proof).toContain('const crossLingualPass = await runPositive(crossLingualQuery);');
        expect(proof).toContain('const tenantPass = tenantResults.length > 0');
        expect(proof).toContain('const semanticPass = banglaPass && englishPass && crossLingualPass && negativePass;');
        expect(proof).toContain('if (!semanticPass || !tenantPass)');
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

    it('keeps active embedding configuration templates on the approved contract', () => {
        const templates = [
            path.join(REPO_ROOT, 'EasyMod-backend', 'scripts', 'generate-secrets.ps1'),
            path.join(REPO_ROOT, 'EasyMod-backend', 'scripts', 'generate-secrets.sh'),
            path.join(REPO_ROOT, 'EasyMod-backend', 'scripts', 'github-secrets-checklist.txt'),
        ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
        expect(templates).toContain('EMBEDDING_PROVIDER=gemini');
        expect(templates).toContain('EMBEDDING_MODEL=text-embedding-3-small');
        expect(templates).toContain('GEMINI_EMBEDDING_MODEL=gemini-embedding-2');
        expect(templates).toContain('QDRANT_VECTOR_SIZE=384');
        expect(templates).not.toContain('text-embedding-004');
    });
});
