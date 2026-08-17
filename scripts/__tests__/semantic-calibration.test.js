'use strict';

const fs = require('fs');
const path = require('path');

const fixtures = require('../semantic-calibration-fixtures');
const calibration = require('../semantic-calibration');

const {
    CONTROLLED_FIXTURE_DOCUMENTS,
    CONTROLLED_POSITIVE_QUERIES,
    CONTROLLED_NEGATIVE_QUERIES,
    POSITIVE_THRESHOLD,
    NEGATIVE_THRESHOLD,
    validateCalibrationFixtures,
    lexicalOverlapTokens,
} = fixtures;

const CALIBRATION_SCRIPT_PATH = path.resolve(__dirname, '../semantic-calibration.js');
const PROOF_SCRIPT_PATH = path.resolve(__dirname, '../qdrant-migration-proof.js');
const CALIBRATION_WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/semantic-embedding-calibration.yml');
const CI_WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/ci-cd.yml');

function fakeEmbeddingVector(input, dimensions) {
    const vector = new Array(dimensions).fill(0);
    const text = String(input || '').toLowerCase();
    let bucket = 20;
    if (text.includes('opening') || text.includes('দোকান')) bucket = 0;
    else if (text.includes('delivery') || text.includes('ডেলিভারি')) bucket = 1;
    else if (text.includes('panjabi') || text.includes('পাঞ্জাবি')) bucket = 2;
    else if (text.includes('return') || text.includes('exchange')) bucket = 3;
    else if (text.includes('shoe') || text.includes('sandal')) bucket = 4;
    else if (text.includes('cash') || text.includes('bkash')) bucket = 5;
    else if (text.includes('order')) bucket = 6;
    else if (text.includes('courier') || text.includes('tracking')) bucket = 7;
    else if (text.includes('stellar') || text.includes('coral') || text.includes('gothic')
        || text.includes('quantum') || text.includes('counterpoint') || text.includes('igneous')
        || text.includes('aerodynamics') || text.includes('trilobite') || text.includes('chlorophyll')
        || text.includes('volcanology')) bucket = 30;
    vector[bucket] = 1;
    return vector;
}

function fakeFetch(url, init) {
    const body = JSON.parse(init.body);
    const dimensions = body.outputDimensionality;
    const input = body.content.parts[0].text;
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ embedding: { values: fakeEmbeddingVector(input, dimensions) } }),
    });
}

describe('controlled semantic calibration fixtures', () => {
    it('contains explicit, deterministic, PII-free multilingual ground truth', () => {
        expect(CONTROLLED_FIXTURE_DOCUMENTS.length).toBe(10);
        expect(CONTROLLED_POSITIVE_QUERIES.length).toBeGreaterThanOrEqual(9);
        expect(CONTROLLED_NEGATIVE_QUERIES.length).toBe(10);
        expect(validateCalibrationFixtures()).toBe(true);
        expect(new Set(CONTROLLED_FIXTURE_DOCUMENTS.map((item) => item.fixtureId)).size)
            .toBe(CONTROLLED_FIXTURE_DOCUMENTS.length);
        expect(CONTROLLED_POSITIVE_QUERIES.every((item) => item.expectedSourceId && item.expectedFact)).toBe(true);
        const fixtureText = CONTROLLED_FIXTURE_DOCUMENTS
            .map((item) => `${item.title} ${item.content}`)
            .join('\n');
        expect(fixtureText).not.toMatch(/https?:\/\//i);
        expect(fixtureText).not.toMatch(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u);
        expect(fixtureText).not.toMatch(/\+?8801\d{9}/u);
    });

    it('rejects a positive query whose authoritative source is missing', () => {
        expect(() => validateCalibrationFixtures({
            positiveQueries: [{
                ...CONTROLLED_POSITIVE_QUERIES[0],
                expectedSourceId: 'fixture-does-not-exist',
            }],
        })).toThrow(/expected source missing/);
    });

    it('rejects a negative query with lexical overlap after proof normalization', () => {
        const negativeQueries = [{
            negativeQueryId: 'negative-overlap',
            query: 'delivery astrophysics',
        }];
        expect(() => validateCalibrationFixtures({ negativeQueries })).toThrow(
            /negative-overlap overlaps fixture-delivery-policy: delivery/,
        );
        expect(lexicalOverlapTokens('delivery astrophysics', CONTROLLED_FIXTURE_DOCUMENTS[1].content))
            .toEqual(['delivery']);
    });

    it('keeps the production thresholds and dimensions unchanged', () => {
        expect(POSITIVE_THRESHOLD).toBe(0.25);
        expect(NEGATIVE_THRESHOLD).toBe(0.5);
        expect(fixtures.CALIBRATION_DIMENSIONS).toBe(384);
        expect(fixtures.DIAGNOSTIC_DIMENSIONS).toBe(768);
    });
});

describe('calibration math and runner isolation', () => {
    it('ranks the expected source and calculates the top-one margin', () => {
        const ranked = calibration.rankDocuments(
            [{ fixtureId: 'source-a' }, { fixtureId: 'source-b' }],
            [[1, 0], [0, 1]],
            [1, 0],
        );
        expect(ranked[0]).toEqual({ fixtureId: 'source-a', score: 1 });
        expect(ranked[1]).toEqual({ fixtureId: 'source-b', score: 0 });
        expect(ranked[0].score - ranked[1].score).toBe(1);
        expect(calibration.cosineSimilarity([1, 0], [0, 1])).toBe(0);
    });

    it('sends the production Gemini payload shape and requested output dimension', async () => {
        const requests = [];
        const fetchImpl = async (url, init) => {
            requests.push({ url, body: JSON.parse(init.body) });
            return {
                ok: true,
                status: 200,
                json: async () => ({ embedding: { values: [1, 0, 0, 0] } }),
            };
        };
        await calibration.requestGeminiEmbedding(
            'task: search result | query: controlled fixture',
            { apiKey: 'test-only-key', dimensions: 4, fetchImpl },
        );
        expect(requests[0].body).toEqual({
            model: 'models/gemini-embedding-2',
            content: { parts: [{ text: 'task: search result | query: controlled fixture' }] },
            outputDimensionality: 4,
        });
        expect(requests[0].url).toContain('/models/gemini-embedding-2:embedContent?key=');
    });

    it('emits full score matrices and calibration evidence without Qdrant access', async () => {
        const artifact = await calibration.runCalibration({
            apiKey: 'test-only-key',
            dimensions: [384],
            fetchImpl: fakeFetch,
            generatedAt: '2026-08-17T00:00:00.000Z',
        });
        expect(artifact.provider).toBe('gemini');
        expect(artifact.model).toBe('gemini-embedding-2');
        expect(artifact.calibration384.dimensions).toBe(384);
        expect(artifact.calibration384.scoreMatrix.positive).toHaveLength(CONTROLLED_POSITIVE_QUERIES.length);
        expect(artifact.calibration384.scoreMatrix.negative).toHaveLength(CONTROLLED_NEGATIVE_QUERIES.length);
        expect(Object.keys(artifact.calibration384.scoreMatrix.positive[0].scores))
            .toHaveLength(CONTROLLED_FIXTURE_DOCUMENTS.length);
        expect(artifact.fixtureCorpus.allPositiveGroundTruthExplicit).toBe(true);
        expect(artifact.fixtureCorpus.allNegativesLexicallyDisjoint).toBe(true);
        expect(artifact.calibration384.summary.positiveTop1Accuracy).toBeGreaterThan(0);
    });

    it('accepts the diagnostic 768 dimension without changing the authoritative 384 default', async () => {
        const artifact = await calibration.runCalibration({
            apiKey: 'test-only-key',
            dimensions: [384, 768],
            fetchImpl: fakeFetch,
            generatedAt: '2026-08-17T00:00:00.000Z',
        });
        expect(artifact.calibration384.dimensions).toBe(384);
        expect(artifact.diagnostic768.dimensions).toBe(768);
        expect(artifact.dimensionComparison.status).toBeDefined();
    });

    it('does not import or reference Qdrant, database, or deployment clients', () => {
        const source = fs.readFileSync(CALIBRATION_SCRIPT_PATH, 'utf8');
        expect(source).not.toMatch(/require\([^)]*(qdrant|pg|redis)/i);
        expect(source).not.toMatch(/\bDATABASE_URL\b|\bQDRANT_URL\b|docker\s+run|\bssh\s+/i);
        expect(source).not.toContain("require('../qdrant-migration-proof')");
    });

    it('removes the unsupported legacy cross-lingual query from the real-source proof', () => {
        const proof = fs.readFileSync(PROOF_SCRIPT_PATH, 'utf8');
        expect(proof).toContain('const crossLingualRecord = null;');
        expect(proof).toContain('const crossLingualQuery = null;');
        expect(proof).not.toMatch(/crossLingualQuery\s*=\s*['"`]/);
    });

    it('keeps the calibration workflow manual-only and free of production credentials', () => {
        const workflow = fs.readFileSync(CALIBRATION_WORKFLOW_PATH, 'utf8');
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).not.toMatch(/^\s+(push|pull_request):/m);
        expect(workflow).toContain('GOOGLE_GEMINI_API_KEY');
        expect(workflow).not.toMatch(/\bQDRANT_URL\b|\bQDRANT_API_KEY\b|\bDATABASE_URL\b|\bDEPLOY_HOST\b|\bDO_SSH_PRIVATE_KEY\b|\bDO_SSH_KNOWN_HOSTS\b|\bDOCKER_PASSWORD\b/i);
        expect(workflow).toContain('PRODUCTION_DEPLOY_ENABLED != \'true\'');
    });

    it('wires proof and calibration helper tests into the backend CI gate', () => {
        const workflow = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
        expect(workflow).toContain('Qdrant proof and semantic calibration helper tests');
        expect(workflow).toContain('../scripts/__tests__/qdrant-migration-proof.test.js');
        expect(workflow).toContain('../scripts/__tests__/semantic-calibration.test.js');
    });
});
