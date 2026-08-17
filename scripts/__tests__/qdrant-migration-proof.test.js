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
    assertPositiveFixture,
    positiveSearchPass,
    NEGATIVE_SEARCH_QUERY,
    sourceStats,
    contentPointFilter,
    safeSourceId,
    emitSearchEvidence,
    normalizeDatabaseUrl,
    normalizeQdrantUrl,
} = require('../qdrant-migration-proof');
const acceptance = require('../semantic-acceptance-contract');
const { Client } = require('pg');
const REPO_ROOT = path.resolve(__dirname, '../..');
const QDRANT_WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/qdrant-migration.yml');
const PROOF_SCRIPT_PATH = path.resolve(__dirname, '../qdrant-migration-proof.js');
const READY_ACCEPTANCE_CONTRACT = {
    ...acceptance.PROOF_ACCEPTANCE_CONTRACT,
    status: 'READY',
    negative_ceiling: 0.62,
    positive_floor_p05: 0.78,
};
const PENDING_ACCEPTANCE_CONTRACT = {
    ...acceptance.PROOF_ACCEPTANCE_CONTRACT,
    status: 'PENDING_RECALIBRATION',
    negative_ceiling: null,
    positive_floor_p05: null,
};

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

    it('accepts a negative fixture only with a ready calibrated contract and lexical check', () => {
        const point = { score: 0.49, payload: { text: 'Cotton saree delivery information' } };

        expect(negativeSearchPass(point, NEGATIVE_SEARCH_QUERY, READY_ACCEPTANCE_CONTRACT, acceptance)).toBe(true);
        expect(negativeSearchPass(null, NEGATIVE_SEARCH_QUERY, READY_ACCEPTANCE_CONTRACT, acceptance)).toBe(true);
        expect(negativeSearchPass(point, NEGATIVE_SEARCH_QUERY, PENDING_ACCEPTANCE_CONTRACT, acceptance))
            .toBe(false);
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
        expect(error.message).toContain('token_hashes=');
        expect(error.message).not.toContain('physics');
        expect(error.message).toContain('source_hash=');
        expect(error.message).not.toContain(sourceId);
        expect(negativeSearchPass(
            { score: 0.49, payload: { text: 'FAQ about physics delivery' } },
            'quantum physics black hole laboratory',
            READY_ACCEPTANCE_CONTRACT,
            acceptance,
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

    it('fails negative search above the calibrated ceiling', () => {
        expect(negativeSearchPass(
            { score: 0.62, payload: { text: 'unrelated proof content' } },
            NEGATIVE_SEARCH_QUERY,
            READY_ACCEPTANCE_CONTRACT,
            acceptance,
        )).toBe(true);
        expect(negativeSearchPass(
            { score: 0.72, payload: { text: 'unrelated proof content' } },
            NEGATIVE_SEARCH_QUERY,
            READY_ACCEPTANCE_CONTRACT,
            acceptance,
        )).toBe(false);
    });

    it('fails closed when a positive fixture has no expected source', () => {
        let error;
        try {
            assertPositiveFixture('bangla', 'private fixture text');
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('positive fixture unavailable: bangla expected source missing');
        expect(error.message).not.toContain('private fixture text');
        expect(() => assertPositiveFixture('bangla', 'private fixture text', { sourceId: 'secret-source' }))
            .not.toThrow();
    });

    it('requires the expected positive source to be the top result', () => {
        const top = { score: 0.65, payload: { documentId: 'source-1' } };

        expect(positiveSearchPass(top, 0, 0.25)).toBe(true);
        expect(positiveSearchPass(top, -1, 0.25)).toBe(false);
        expect(positiveSearchPass(top, 1, 0.25)).toBe(false);
        expect(positiveSearchPass({ score: 0.24 }, 0, 0.25)).toBe(false);
    });

    it('keeps positive-language and tenant-isolation gates wired into validation', () => {
        const proof = fs.readFileSync(PROOF_SCRIPT_PATH, 'utf8');

        expect(proof).toContain("runPositive('bangla', banglaQuery, banglaRecord)");
        expect(proof).toContain("runPositive('english', englishQuery, englishRecord)");
        expect(proof).toContain("runPositive('cross-lingual', crossLingualQuery, crossLingualRecord)");
        expect(proof).toContain('const crossLingualRecord = null;');
        expect(proof).toContain('const crossLingualQuery = null;');
        expect(proof).not.toMatch(/crossLingualQuery\s*=\s*['"`]/);
        expect(proof).toContain('assertPositiveFixture(caseId, query, expectedRecord);');
        expect(proof).toContain('const pass = positiveSearchPass(');
        expect(proof).toContain('acceptanceModule.assertAcceptanceContract');
        expect(proof).toContain('NEGATIVE_ACCEPTANCE_RULE=');
        expect(proof).toContain('const tenantPass = tenantResults.length > 0');
        expect(proof).toContain('const semanticPass = banglaPass && englishPass && crossLingualPass && negativePass;');
        expect(proof).toContain('if (!semanticPass || !tenantPass)');
        expect(proof).toContain('EXPECTED_SOURCE_RANK=');
        expect(proof).toContain('EXPECTED_SOURCE_SCORE=');
        expect(proof).toContain('TOP_K_SOURCE_IDS_AND_SCORES=');
        expect(proof).toContain('FAILURE_REASON=');
        expect(proof).toContain('PASS_EMPTY_EXISTING_BOUND');
        expect(proof).not.toContain('deleteCollection');
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

    it('proves provider-bound spaces and collection-only fallback', () => {
        const workflow = fs.readFileSync(QDRANT_WORKFLOW_PATH, 'utf8');

        expect(workflow).toContain('OPENAI_FALLBACK_MODEL=text-embedding-3-small');
        expect(workflow).toContain('GEMINI_MODEL="${GEMINI_EMBEDDING_MODEL:-gemini-embedding-2}"');
        expect(workflow).toContain('run_space_safety');
        expect(workflow).toContain('space-safety');
        expect(workflow.indexOf('run_reindex gemini')).toBeLessThan(workflow.indexOf('run_reindex openai'));
        expect(workflow).toMatch(
            /run_reindex openai \"\$OPENAI_FALLBACK_MODEL\" \"\$GEMINI_MODEL\"/,
        );
        expect(workflow).toMatch(
            /run_provider_proof openai \"\$OPENAI_FALLBACK_MODEL\" \"\$GEMINI_MODEL\"/,
        );
        expect(workflow).toContain('CROSS_SPACE_QUERY_REJECTION');
        expect(workflow).toContain('CROSS_SPACE_WRITE_REJECTION');
        expect(workflow).toContain('EMBEDDING_SPACE_SAFETY=PASS');
        expect(workflow).toContain('OPENAI_ROLLBACK_COLLECTION="${OPENAI_ROLLBACK_COLLECTION_BASE}_${WORKFLOW_RUN_ID}"');
        expect(workflow).not.toContain('text-embedding-004');
        expect(workflow).not.toMatch(/docker (?:rm|compose .*rm).*knowledge_documents/);
        expect(workflow).toContain('PRODUCTION_DEPLOY_ENABLED:-false');
        expect(workflow).toContain('semantic-acceptance-contract.js');
        expect(workflow).toContain('SEMANTIC_ACCEPTANCE_CONTRACT_PATH');
    });

    it('adds a manifest exclusion to every content count/search filter', () => {
        expect(contentPointFilter()).toEqual({
            must_not: [{ key: 'embedding_space_manifest', match: { value: true } }],
        });
        expect(contentPointFilter({ must: [{ key: 'shopId', match: { value: 'shop-1' } }] }).must_not)
            .toEqual(expect.arrayContaining([{ key: 'embedding_space_manifest', match: { value: true } }]));
    });

    it('emits score/rank evidence without exposing source identifiers', () => {
        const lines = [];
        const realLog = console.log;
        console.log = (line) => lines.push(line);
        try {
            emitSearchEvidence({
                identity: {
                    provider: 'openai',
                    model: 'text-embedding-3-small',
                    embedding_space_version: 'openai-v1',
                    dimensions: 384,
                },
                collection: 'proof_collection',
                caseId: 'english',
                expectedSourceId: 'merchant-secret-id',
                top: { id: 'top-id', score: 0.82, payload: { documentId: 'merchant-secret-id' } },
                expectedRank: 1,
                expectedScore: 0.82,
                results: [{ id: 'top-id', score: 0.82, payload: { documentId: 'merchant-secret-id' } }],
                positiveThreshold: 0.25,
                lexicalOverlap: false,
                pass: true,
                failureReason: 'NONE',
            });
        } finally {
            console.log = realLog;
        }
        expect(lines.join('\n')).toContain('EXPECTED_SOURCE_RANK=1');
        expect(lines.join('\n')).toContain('EXPECTED_SOURCE_SCORE=0.820000');
        expect(lines.join('\n')).toContain('TOP_SCORE=0.820000');
        expect(lines.join('\n')).not.toContain('merchant-secret-id');
        expect(safeSourceId('merchant-secret-id')).toMatch(/^[a-f0-9]{16}$/);
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
