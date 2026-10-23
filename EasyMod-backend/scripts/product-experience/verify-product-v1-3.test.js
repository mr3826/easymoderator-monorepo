'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { finalizeEvidenceAndRefreshManifest, findCandidateRealGeminiRunId, partitionStartupValidation, requiredEnv, runCapture } = require('./verify-product-v1-3');
const { run: runIntegrationCommand } = require('./run-integration');

describe('offline verifier environment isolation', () => {
    test('removes credentials and every provider opt-in from default child processes', () => {
        const optIns = [
            'EM-GEMINI-KEY', 'LAB_RUN_MODE', 'LAB_GEMINI_PRO_PHOTO_PROBE', 'LAB_PRO_PHOTO_CAMPAIGN_ID',
            'LAB_PRO_PHOTO_RESULT_PATH', 'LAB_GEMINI_LITE_PHOTO_DIAGNOSTIC',
            'LAB_GEMINI_LITE_PHOTO_CAMPAIGN_ID', 'LAB_GEMINI_LITE_PHOTO_RESULT_PATH',
            'LAB_RUN_GENUINE_PHOTO_EVAL', 'LAB_RUN_SYNTHETIC_VISION', 'EASYMOD_LIVE_GEMINI_EGRESS',
        ];
        const previous = new Map(optIns.map(key => [key, process.env[key]]));
        try {
            for (const key of optIns) process.env[key] = 'test-only-value';
            const childEnv = requiredEnv();

            expect(childEnv.LAB_RUN_MODE).toBe('offline');
            expect(childEnv.EASYMOD_LIVE_GEMINI_EGRESS).toBe('0');
            for (const key of optIns.filter(key => key !== 'LAB_RUN_MODE' && key !== 'EASYMOD_LIVE_GEMINI_EGRESS')) {
                expect(childEnv[key]).toBeUndefined();
            }
        } finally {
            for (const [key, value] of previous) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });
});

describe('verifier startup dependency classification', () => {
    test('records a missing Docker engine as a failed integration prerequisite without blocking independent gates', () => {
        expect(typeof partitionStartupValidation).toBe('function');
        expect(partitionStartupValidation([
            'DOCKER_ENGINE_UNAVAILABLE',
            'CANDIDATE_BRANCH_MISMATCH',
            'EM_GEMINI_KEY_UNAVAILABLE',
        ])).toEqual({
            blocking: ['CANDIDATE_BRANCH_MISMATCH', 'EM_GEMINI_KEY_UNAVAILABLE'],
            failedPrerequisites: ['DOCKER_ENGINE_UNAVAILABLE'],
        });
    });
});

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

describe('verification evidence finalization', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-v13-finalization-'));
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('refreshes proof and checksum manifest only after writing the completed receipt', async () => {
        const receiptPath = path.join(root, 'artifacts', 'regression', 'verify-test.json');
        const archivedProofPath = path.join(root, 'artifacts', 'reports', 'proof.md');
        const manifestPath = path.join(root, 'artifacts', 'security', 'artifact-checksum-manifest.txt');
        const events = [];

        const result = await finalizeEvidenceAndRefreshManifest({
            finalizeReceipt: () => {
                events.push('receipt');
                fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
                const receipt = { complete: true, status: 'PASS', finishedAt: 'now' };
                fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
                return receipt;
            },
            refreshProof: receipt => {
                events.push('proof');
                expect(receipt.complete).toBe(true);
                const markdown = `complete=${receipt.complete}`;
                fs.mkdirSync(path.dirname(archivedProofPath), { recursive: true });
                fs.writeFileSync(archivedProofPath, markdown);
                return { runnerStep: { status: 'PASS' }, completedReceipt: true, archiveCreated: true };
            },
            runPrivacyScan: () => {
                events.push('scan');
                const files = [receiptPath, archivedProofPath];
                fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
                fs.writeFileSync(manifestPath, files.map(file => {
                    const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
                    const relativePath = path.relative(root, file).replaceAll(path.sep, '/');
                    return `${digest}  ${relativePath}`;
                }).join('\n') + '\n');
                return { status: 'PASS', exitCode: 0 };
            },
            receiptPath,
            archivedProofPath,
            manifestPath,
            repoRoot: root,
        });

        expect(events).toEqual(['receipt', 'proof', 'scan']);
        expect(result.receiptComplete).toBe(true);
        expect(result.manifestCoversReceipt).toBe(true);
        expect(result.manifestCoversArchivedProof).toBe(true);
        expect(result.passed).toBe(true);
    });

    test('fails finalization when the post-completion manifest misses the finalized receipt', async () => {
        const receiptPath = path.join(root, 'artifacts', 'regression', 'verify-test.json');
        const archivedProofPath = path.join(root, 'artifacts', 'reports', 'proof.md');
        const manifestPath = path.join(root, 'artifacts', 'security', 'artifact-checksum-manifest.txt');

        const result = await finalizeEvidenceAndRefreshManifest({
            finalizeReceipt: () => {
                fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
                fs.writeFileSync(receiptPath, '{"complete":true}\n');
                return { complete: true, status: 'PASS' };
            },
            refreshProof: () => {
                fs.mkdirSync(path.dirname(archivedProofPath), { recursive: true });
                fs.writeFileSync(archivedProofPath, 'final proof');
                return { runnerStep: { status: 'PASS' }, completedReceipt: true, archiveCreated: true };
            },
            runPrivacyScan: () => {
                fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
                fs.writeFileSync(manifestPath, '0'.repeat(64) + '  artifacts/regression/verify-test.json\n');
                return { status: 'PASS', exitCode: 0 };
            },
            receiptPath,
            archivedProofPath,
            manifestPath,
            repoRoot: root,
        });

        expect(result.manifestCoversReceipt).toBe(false);
        expect(result.passed).toBe(false);
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
