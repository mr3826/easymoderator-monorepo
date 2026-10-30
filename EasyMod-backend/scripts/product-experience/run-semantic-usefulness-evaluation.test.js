'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
    inputBoundFor,
    reservationFor,
    loadMatchedComparison,
    MAX_INPUT_TOKENS,
    MAX_OUTPUT_TOKENS,
    MAX_REQUESTS,
    CEILING_USD,
} = require('./run-semantic-usefulness-evaluation');
const { GEMINI_PRICE_SNAPSHOT, GEMINI_PRO_PRICE_SNAPSHOT } = require('./evaluation-budget');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

const makeEvidence = root => {
    const baseline = {
        runId: 'baseline-run', status: 'completed', sourceRevision: 'baseline-commit', runnerSourceSha256: 'r'.repeat(64),
        engineSourceSha256: 'b'.repeat(64), dataset: { sha256: 'd'.repeat(64) },
        benchmarkOracle: { oracleSha256: 'o'.repeat(64) }, turns: Array.from({ length: 200 }, () => ({})),
    };
    const candidate = {
        runId: 'candidate-run', status: 'completed', sourceRevision: 'candidate-commit', runnerSourceSha256: 'r'.repeat(64),
        engineSourceSha256: 'c'.repeat(64), dataset: { sha256: 'd'.repeat(64) },
        benchmarkOracle: { oracleSha256: 'o'.repeat(64) }, turns: Array.from({ length: 200 }, () => ({})),
    };
    const writeRun = (filename, run, engine, sourceSha) => {
        const relativePath = `runs/${filename}.json`;
        const absolutePath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        const bytes = Buffer.from(JSON.stringify(run));
        fs.writeFileSync(absolutePath, bytes);
        return { engine, status: 'PASS', artifactPath: relativePath, artifactSha256: digest(bytes), engineSourceSha256: sourceSha };
    };
    const results = [
        writeRun('baseline', baseline, 'baseline-v1-2', baseline.engineSourceSha256),
        writeRun('candidate', candidate, 'candidate-v1-3', candidate.engineSourceSha256),
    ];
    fs.mkdirSync(path.join(root, 'comparisons'), { recursive: true });
    fs.writeFileSync(path.join(root, 'comparisons', 'comparison-1.json'), JSON.stringify({
        comparisonId: 'comparison-1', mode: 'real-gemini', dataset: 'heldout', comparisonValid: true,
        sameDenominator: true, candidateCommit: 'candidate-commit', baselineCommit: 'baseline-commit',
        datasetSha256: 'd'.repeat(64), oracleSha256: 'o'.repeat(64), results,
    }));
    return { baseline, candidate };
};

describe('semantic evaluation paid-run input validation', () => {
    test('pins the aggregate paid-judge ceiling and bounded two-model request envelope', () => {
        expect(CEILING_USD).toBe(0.85);
        expect(MAX_INPUT_TOKENS).toBe(4096);
        expect(MAX_OUTPUT_TOKENS).toBe(512);
        expect(MAX_REQUESTS).toBe(230);
        expect(inputBoundFor({ systemPrompt: 'abc', messages: [{ content: 'de' }] })).toBe(5);
        const hardTokenBound = 200 * reservationFor(4096, GEMINI_PRICE_SNAPSHOT)
            + 30 * reservationFor(4096, GEMINI_PRO_PRICE_SNAPSHOT);
        expect(hardTokenBound).toBeLessThan(CEILING_USD);
    });

    test('loads only hash-matched complete paired runs from a valid held-out Gemini comparison', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-usefulness-matched-'));
        try {
            const runs = makeEvidence(root);
            const matched = loadMatchedComparison({
                artifactRoot: root,
                comparisonId: 'comparison-1',
                currentHead: 'candidate-commit',
                currentRunnerSourceSha256: 'r'.repeat(64),
            });
            expect(matched.comparisonSha256).toMatch(/^[a-f0-9]{64}$/);
            expect(matched.baseline.run.runId).toBe(runs.baseline.runId);
            expect(matched.candidate.run.runId).toBe(runs.candidate.runId);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects a stale runner, mismatched candidate commit, and an artifact path outside the package', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-usefulness-stale-'));
        try {
            makeEvidence(root);
            const comparisonPath = path.join(root, 'comparisons', 'comparison-1.json');
            const comparison = JSON.parse(fs.readFileSync(comparisonPath, 'utf8'));
            const candidatePath = path.join(root, comparison.results[1].artifactPath);
            const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
            candidate.runnerSourceSha256 = 'x'.repeat(64);
            fs.writeFileSync(candidatePath, JSON.stringify(candidate));
            comparison.results[1].artifactSha256 = digest(fs.readFileSync(candidatePath));
            fs.writeFileSync(comparisonPath, JSON.stringify(comparison));
            expect(() => loadMatchedComparison({
                artifactRoot: root, comparisonId: 'comparison-1', currentHead: 'candidate-commit',
                currentRunnerSourceSha256: 'r'.repeat(64),
            })).toThrow('STALE_RUNNER_ORACLE_OR_DATASET');

            candidate.runnerSourceSha256 = 'r'.repeat(64);
            fs.writeFileSync(candidatePath, JSON.stringify(candidate));
            comparison.results[1].artifactSha256 = digest(fs.readFileSync(candidatePath));
            comparison.results[1].artifactPath = '../outside.json';
            fs.writeFileSync(comparisonPath, JSON.stringify(comparison));
            expect(() => loadMatchedComparison({
                artifactRoot: root, comparisonId: 'comparison-1', currentHead: 'candidate-commit',
                currentRunnerSourceSha256: 'r'.repeat(64),
            })).toThrow('COMPARISON_RUN_PATH_INVALID');
            expect(() => loadMatchedComparison({
                artifactRoot: root, comparisonId: 'comparison-1', currentHead: 'other-commit',
                currentRunnerSourceSha256: 'r'.repeat(64),
            })).toThrow('MATCHED_REAL_HELDOUT_COMPARISON_REQUIRED');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
