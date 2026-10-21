'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findCandidateRealGeminiRunId } = require('./verify-product-v1-3');

describe('paid candidate run discovery for browser QA', () => {
    let root;
    let comparisonRoot;
    const query = {
        sourceSha256: 'a'.repeat(64),
        oracleSha256: 'b'.repeat(64),
        backendSourceSha256: 'c'.repeat(64),
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-v13-run-discovery-'));
        comparisonRoot = path.join(root, 'comparisons');
        fs.mkdirSync(comparisonRoot);
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('selects the current valid candidate run and rejects stale or mismatched comparisons', () => {
        const comparison = {
            mode: 'real-gemini',
            dataset: 'source',
            datasetSha256: query.sourceSha256,
            oracleSha256: query.oracleSha256,
            comparisonValid: true,
            results: [
                {
                    engine: 'candidate-v1-3',
                    status: 'PASS',
                    engineSourceSha256: query.backendSourceSha256,
                    completedAt: '2026-10-22T02:00:00.000Z',
                    summary: { runId: 'candidate-current' },
                },
            ],
        };
        fs.writeFileSync(path.join(comparisonRoot, 'real-gemini-source-current.json'), JSON.stringify(comparison));
        fs.writeFileSync(path.join(comparisonRoot, 'real-gemini-source-stale.json'), JSON.stringify({
            ...comparison,
            datasetSha256: 'd'.repeat(64),
            results: [{ ...comparison.results[0], summary: { runId: 'candidate-stale' } }],
        }));

        expect(findCandidateRealGeminiRunId({ comparisonRoot, ...query })).toBe('candidate-current');
        expect(findCandidateRealGeminiRunId({ comparisonRoot, ...query, oracleSha256: 'e'.repeat(64) })).toBeNull();
    });
});
