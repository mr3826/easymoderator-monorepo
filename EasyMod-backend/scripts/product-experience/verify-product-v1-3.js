'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { backendSourceSha256 } = require('./generate-product-engine-v1-3-proof');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');
const ARTIFACT_ROOT = path.resolve(process.env.LAB_ARTIFACT_ROOT
    || path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-3', 'artifacts'));
const NODE = process.execPath;
const SOURCE_CSV = path.join(WORKSPACE_ROOT, 'customer-simulator.csv');
const EXPECTED_SOURCE_SHA256 = '892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6';
const BASELINE_ROOT = path.join(WORKSPACE_ROOT, '_wt-verified-commerce-v1-2');
const BASELINE_SHA = '957bb991a18db1949369a6f805822b8c8b69889b';
const paidOptIn = process.argv.includes('--paid-gemini');

const runCapture = (command, args, env, timeoutMs = 20 * 60 * 1000) => new Promise(resolve => {
    const child = spawn(command, args, {
        cwd: BACKEND_ROOT,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const hash = crypto.createHash('sha256');
    let output = '';
    let timedOut = false;
    const keep = chunk => {
        const text = chunk.toString('utf8');
        hash.update(text);
        output = `${output}${text}`.slice(-2_000_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once('error', error => {
        clearTimeout(timer);
        resolve({ exitCode: 1, timedOut: false, output, outputSha256: hash.digest('hex'), error: error.code || 'PROCESS_START_FAILED' });
    });
    child.once('close', code => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, timedOut, output, outputSha256: hash.digest('hex'), error: null });
    });
});

const runStep = async (name, command, args, env, timeoutMs) => {
    process.stdout.write(`[verify] START ${name}\n`);
    const heartbeat = setInterval(() => process.stdout.write(`[verify] RUNNING ${name}\n`), 45_000);
    const startedAt = new Date().toISOString();
    const execution = await runCapture(command, args, env, timeoutMs);
    clearInterval(heartbeat);
    const step = {
        name,
        status: execution.exitCode === 0 && !execution.timedOut ? 'PASS' : 'FAIL',
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        startedAt,
        completedAt: new Date().toISOString(),
        outputSha256: execution.outputSha256,
        failureCode: execution.error,
        summary: execution.output.split(/\r?\n/).filter(line => line.startsWith('Test Suites:')
            || line.startsWith('Tests:') || line.startsWith('Snapshots:')
            || line.startsWith('Time:') || line.includes('Playwright PASS')
            || line.startsWith('{"status":')).slice(-8),
    };
    process.stdout.write(`[verify] ${step.status} ${name}\n`);
    return step;
};

const findCandidateRealGeminiRunId = ({ comparisonRoot, sourceSha256, oracleSha256, backendSourceSha256: candidateSourceSha256 }) => {
    if (typeof comparisonRoot !== 'string' || !path.isAbsolute(comparisonRoot)
        || typeof sourceSha256 !== 'string' || typeof oracleSha256 !== 'string'
        || typeof candidateSourceSha256 !== 'string' || !fs.existsSync(comparisonRoot)) return null;
    return fs.readdirSync(comparisonRoot)
        .filter(filename => filename.endsWith('.json'))
        .map(filename => {
            try { return JSON.parse(fs.readFileSync(path.join(comparisonRoot, filename), 'utf8')); } catch (_) { return null; }
        })
        .filter(comparison => comparison?.mode === 'real-gemini'
            && comparison.dataset === 'source'
            && comparison.datasetSha256 === sourceSha256
            && comparison.comparisonValid === true
            && comparison.oracleSha256 === oracleSha256)
        .map(comparison => ({
            comparison,
            candidate: comparison.results?.find(result => result.engine === 'candidate-v1-3'),
        }))
        .filter(entry => entry.candidate?.status === 'PASS'
            && entry.candidate.engineSourceSha256 === candidateSourceSha256
            && typeof entry.candidate.summary?.runId === 'string')
        .sort((left, right) => String(right.candidate.completedAt || '').localeCompare(String(left.candidate.completedAt || '')))
        .map(entry => entry.candidate.summary.runId)[0] || null;
};

const requiredEnv = () => {
    const env = { ...process.env };
    for (const key of [
        'EM-GEMINI-KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY', 'EASYMOD_LIVE_GEMINI_EGRESS', 'LAB_REAL_GEMINI_RUN_ID',
    ]) delete env[key];
    env.NODE_ENV = 'test';
    env.EASYMOD_LIVE_GEMINI_EGRESS = '0';
    return env;
};

const main = async () => {
    const startedAt = new Date().toISOString();
    const validation = [];
    let candidateCommit = null;
    let candidateBranch = null;
    let worktreeCleanAtStart = false;
    let candidateBackendSourceSha256 = null;
    try {
        candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
        candidateBranch = execFileSync('git', ['branch', '--show-current'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
        worktreeCleanAtStart = !execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
        candidateBackendSourceSha256 = backendSourceSha256();
        if (candidateBranch !== 'feature/product-engine-v1.3-customer-truth') validation.push('CANDIDATE_BRANCH_MISMATCH');
        if (!worktreeCleanAtStart) validation.push('CANDIDATE_WORKTREE_NOT_CLEAN');
    } catch (_) { validation.push('CANDIDATE_GIT_STATE_UNAVAILABLE'); }
    if (process.versions.node.split('.')[0] !== '20') validation.push('NODE_20_REQUIRED');
    try {
        const baselineSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: BASELINE_ROOT, encoding: 'utf8' }).trim();
        if (baselineSha !== BASELINE_SHA) validation.push('FROZEN_V1_2_BASELINE_MISMATCH');
    } catch (_) { validation.push('FROZEN_V1_2_BASELINE_UNAVAILABLE'); }
    try {
        const sourceSha = crypto.createHash('sha256').update(fs.readFileSync(SOURCE_CSV)).digest('hex');
        if (sourceSha !== EXPECTED_SOURCE_SHA256) validation.push('SOURCE_CORPUS_HASH_MISMATCH');
    } catch (_) { validation.push('SOURCE_CORPUS_UNAVAILABLE'); }
    const python = spawnSync('python', ['--version'], { encoding: 'utf8', windowsHide: true });
    if (python.status !== 0 || !/^Python 3\./m.test(`${python.stdout || ''}${python.stderr || ''}`)) validation.push('PYTHON_3_REQUIRED');
    const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', windowsHide: true });
    if (docker.status !== 0 || !String(docker.stdout || '').trim()) validation.push('DOCKER_ENGINE_UNAVAILABLE');
    if (paidOptIn && !process.env['EM-GEMINI-KEY']?.trim()) validation.push('EM_GEMINI_KEY_UNAVAILABLE');
    if (validation.length) {
        process.stderr.write(`[verify] BLOCKED ${validation.join(',')}\n`);
        process.exitCode = 1;
        return;
    }

    fs.mkdirSync(path.join(ARTIFACT_ROOT, 'security'), { recursive: true });
    const steps = [];
    const offline = requiredEnv();

    steps.push(await runStep('source-oracle-preparation', NODE, [path.join(__dirname, 'benchmark-oracle.js')], offline));
    steps.push(await runStep('held-out-fixture-preparation', NODE, [path.join(__dirname, 'generate-heldout-benchmark.js')], offline));
    const heldoutOracleEnv = {
        ...offline,
        LAB_DATASET_PATH: path.join(ARTIFACT_ROOT, 'benchmarks', 'heldout-customer-questions.csv'),
        LAB_ORACLE_PATH: path.join(ARTIFACT_ROOT, 'benchmarks', 'heldout-customer-truth-oracle.json'),
    };
    steps.push(await runStep('held-out-oracle-preparation', NODE, [path.join(__dirname, 'benchmark-oracle.js')], heldoutOracleEnv));
    steps.push(await runStep('postgres-redis-worker-webhook-and-full-backend-regression', NODE, [path.join(__dirname, 'run-integration.js')], offline, 20 * 60 * 1000));
    const securityEnv = { ...offline, GROWTH_OS_ENABLED: 'false' };
    const securityScript = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8')).scripts['test:security'];
    const securityArgs = securityScript.split(/\s+/).slice(1);
    steps.push(await runStep('backend-security-suite', NODE, [path.join(BACKEND_ROOT, 'node_modules', 'jest', 'bin', 'jest.js'), ...securityArgs], securityEnv, 15 * 60 * 1000));

    for (const dataset of ['source', 'heldout']) {
        const env = { ...offline, LAB_COMPARISON_MODE: 'deterministic', LAB_COMPARISON_DATASET: dataset, LAB_RUN_SCOPE: 'full' };
        steps.push(await runStep(`deterministic-${dataset}-comparison`, NODE, [path.join(__dirname, 'run-engine-comparison.js')], env, 15 * 60 * 1000));
    }

    let realGeminiCandidateRunId = null;
    if (paidOptIn) {
        const paidEnv = { ...offline, 'EM-GEMINI-KEY': process.env['EM-GEMINI-KEY'],
            LAB_COMPARISON_MODE: 'real-gemini', LAB_COMPARISON_DATASET: 'source', LAB_RUN_SCOPE: 'full' };
        const paidComparison = await runStep('paid-gemini-source-and-genuine-photo-comparison-cap-usd-2', NODE, [path.join(__dirname, 'run-engine-comparison.js')], paidEnv, 35 * 60 * 1000);
        steps.push(paidComparison);
        if (paidComparison.status === 'PASS') {
            try {
                const oraclePath = path.join(ARTIFACT_ROOT, 'benchmarks', 'customer-truth-oracle.json');
                const oracleSha256 = JSON.parse(fs.readFileSync(oraclePath, 'utf8')).oracleSha256;
                realGeminiCandidateRunId = findCandidateRealGeminiRunId({
                    comparisonRoot: path.join(ARTIFACT_ROOT, 'comparisons'),
                    sourceSha256: EXPECTED_SOURCE_SHA256,
                    oracleSha256,
                    backendSourceSha256: candidateBackendSourceSha256,
                });
            } catch (_) { realGeminiCandidateRunId = null; }
        }
        steps.push({
            name: 'paid-gemini-candidate-run-discovery',
            status: realGeminiCandidateRunId ? 'PASS' : 'FAIL',
            exitCode: realGeminiCandidateRunId ? 0 : 1,
            timedOut: false,
            summary: realGeminiCandidateRunId ? ['Matched the current paid source comparison to its candidate run.'] : ['No valid current paid candidate run could be matched.'],
        });
    } else {
        steps.push({ name: 'paid-gemini-source-and-genuine-photo-comparison', status: 'NOT_RUN_OFFLINE_DEFAULT' });
    }

    const playwrightEnv = realGeminiCandidateRunId
        ? { ...offline, LAB_REAL_GEMINI_RUN_ID: realGeminiCandidateRunId }
        : offline;
    steps.push(await runStep('local-test-lab-playwright', NODE, [path.join(__dirname, 'run-lab-playwright.js')], playwrightEnv, 10 * 60 * 1000));
    steps.push(await runStep('privacy-scanner-unit-tests', 'python', [path.join(__dirname, 'test_scan_artifact_privacy.py')], offline));
    steps.push(await runStep('trace-sanitizer-unit-tests', 'python', [path.join(__dirname, 'test_sanitize_playwright_traces.py')], offline));

    const privacyOutput = path.join(ARTIFACT_ROOT, 'security', 'artifact-privacy-scan.json');
    const privacyManifest = path.join(ARTIFACT_ROOT, 'security', 'artifact-checksum-manifest.txt');
    steps.push(await runStep('artifact-privacy-scan-and-checksum-manifest', 'python', [
        path.join(__dirname, 'scan-artifact-privacy.py'),
        '--csv', SOURCE_CSV,
        '--artifacts', ARTIFACT_ROOT,
        '--output', privacyOutput,
        '--manifest', privacyManifest,
    ], offline, 10 * 60 * 1000));

    const generator = path.join(__dirname, 'generate-product-engine-v1-3-proof.js');
    const proofStep = await runStep('consolidated-cost-and-proof-generation', NODE, [generator], offline, 60_000);
    steps.push(proofStep);

    const overall = steps.every(step => step.status === 'PASS'
        || step.status === 'NOT_RUN_OFFLINE_DEFAULT');
    const receipt = {
        schemaVersion: 1,
        runId: crypto.randomUUID(),
        status: overall ? 'PASS' : 'FAIL',
        mode: paidOptIn ? 'PAID_OPT_IN' : 'OFFLINE_DEFAULT',
        startedAt,
        completedAt: new Date().toISOString(),
        nodeVersion: process.versions.node,
        candidateCommit,
        candidateBranch,
        candidateBackendSourceSha256,
        worktreeCleanAtStart,
        baselineSha: BASELINE_SHA,
        sourceCorpusSha256: EXPECTED_SOURCE_SHA256,
        providerCallsAllowedByEntrypoint: paidOptIn,
        providerBudgetCapUsd: paidOptIn ? 2 : 0,
        steps,
    };
    const receiptPath = path.join(ARTIFACT_ROOT, 'regression', `verify-${receipt.runId}.json`);
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(`[verify] ${receipt.status} mode=${receipt.mode} receipt=${receiptPath}\n`);
    if (!overall) process.exitCode = 1;
};

if (require.main === module) main().catch(() => {
    process.stderr.write('[verify] FAIL VERIFICATION_ENTRYPOINT_ERROR\n');
    process.exitCode = 1;
});

module.exports = { findCandidateRealGeminiRunId };
