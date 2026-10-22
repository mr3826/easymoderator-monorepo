'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findCandidateRealGeminiRunId, runCapture } = require('./verify-product-v1-3');
const { run: runIntegrationCommand } = require('./run-integration');

describe('paid candidate run discovery for browser QA', () => {
    let root;
    let comparisonRoot;
    const query = {
        sourceSha256: 'a'.repeat(64),
        oracleSha256: 'b'.repeat(64),
        backendSourceSha256: 'c'.repeat(64),
        runnerSourceSha256: 'd'.repeat(64),
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-v13-run-discovery-'));
        comparisonRoot = path.join(root, 'comparisons');
        fs.mkdirSync(comparisonRoot);
        fs.mkdirSync(path.join(root, 'runs'));
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
                    artifactPath: 'runs/candidate-current.json',
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
        fs.writeFileSync(path.join(root, 'runs', 'candidate-current.json'), JSON.stringify({ runnerSourceSha256: query.runnerSourceSha256 }));
        fs.writeFileSync(path.join(root, 'runs', 'candidate-stale-runner.json'), JSON.stringify({ runnerSourceSha256: 'e'.repeat(64) }));
        fs.writeFileSync(path.join(comparisonRoot, 'real-gemini-source-stale-runner.json'), JSON.stringify({
            ...comparison,
            results: [{ ...comparison.results[0], artifactPath: 'runs/candidate-stale-runner.json', summary: { runId: 'candidate-stale-runner' } }],
        }));

        expect(findCandidateRealGeminiRunId({ comparisonRoot, ...query })).toBe('candidate-current');
        expect(findCandidateRealGeminiRunId({ comparisonRoot, ...query, oracleSha256: 'e'.repeat(64) })).toBeNull();
        expect(findCandidateRealGeminiRunId({ comparisonRoot, ...query, runnerSourceSha256: 'f'.repeat(64) })).toBeNull();
    });
});

describe('verification subprocess timeouts', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-v13-timeout-'));
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('terminates the process tree and resolves promptly when a verifier step times out', async () => {
        const childPidPath = path.join(root, 'descendant.pid');
        const script = [
            'const fs = require("node:fs");',
            'const { spawn } = require("node:child_process");',
            'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
            'fs.writeFileSync(process.env.LAB_TIMEOUT_TEST_DESCENDANT_PID, String(descendant.pid));',
            'setInterval(() => {}, 1000);',
        ].join('\n');
        const startedAt = Date.now();

        const result = await runCapture(process.execPath, ['-e', script], {
            ...testChildEnvironment(),
            LAB_TIMEOUT_TEST_DESCENDANT_PID: childPidPath,
        }, 500);

        expect(result.timedOut).toBe(true);
        expect(Date.now() - startedAt).toBeLessThan(5000);
        const descendantPid = Number(fs.readFileSync(childPidPath, 'utf8'));
        for (let attempt = 0; attempt < 20 && isProcessAlive(descendantPid); attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(isProcessAlive(descendantPid)).toBe(false);
    });

    test('integration-stage timeouts also terminate descendants and return bounded cleanup evidence', async () => {
        const childPidPath = path.join(root, 'integration-descendant.pid');
        const script = [
            'const fs = require("node:fs");',
            'const { spawn } = require("node:child_process");',
            'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
            'fs.writeFileSync(process.env.LAB_TIMEOUT_TEST_DESCENDANT_PID, String(descendant.pid));',
            'setInterval(() => {}, 1000);',
        ].join('\n');
        const startedAt = Date.now();
        const result = await runIntegrationCommand(process.execPath, ['-e', script], {
            cwd: root,
            env: { ...testChildEnvironment(), LAB_TIMEOUT_TEST_DESCENDANT_PID: childPidPath },
            timeoutMs: 500,
        });

        expect(result.timedOut).toBe(true);
        expect(Date.now() - startedAt).toBeLessThan(5000);
        expect(result.timeoutCleanup).not.toBe('NO_PROCESS_ID');
        const descendantPid = Number(fs.readFileSync(childPidPath, 'utf8'));
        for (let attempt = 0; attempt < 20 && isProcessAlive(descendantPid); attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(isProcessAlive(descendantPid)).toBe(false);
    });
});

const isProcessAlive = pid => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
};

const testChildEnvironment = () => Object.fromEntries([
    'PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
].filter(key => process.env[key]).map(key => [key, process.env[key]]));
