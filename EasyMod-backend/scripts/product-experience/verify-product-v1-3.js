'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { backendSourceSha256 } = require('./generate-product-engine-v1-3-proof');
const { terminateProcessTree } = require('./terminate-process-tree');

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
const DOCKER_PREFLIGHT_TIMEOUT_MS = 5000;
const paidOptIn = process.argv.includes('--paid-gemini');
const PLAYWRIGHT_GATE_TIMEOUT_MS = 20 * 60 * 1000;
const resolvePaidGeminiKey = (env = process.env) => {
    const userEnvironmentKey = String(env.EM_GEMINI_KEY || '').trim();
    const processScopedKey = String(env['EM-GEMINI-KEY'] || '').trim();
    return userEnvironmentKey || processScopedKey || null;
};
const shouldRequireDockerEngine = (env = process.env) => env.LAB_EXTERNAL_SERVICES !== 'true';
const dockerInfo = (run = spawnSync) => run('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8', windowsHide: true, timeout: DOCKER_PREFLIGHT_TIMEOUT_MS,
});
const partitionStartupValidation = issues => ({
    blocking: issues.filter(issue => issue !== 'DOCKER_ENGINE_UNAVAILABLE'),
    failedPrerequisites: issues.filter(issue => issue === 'DOCKER_ENGINE_UNAVAILABLE'),
});
const canRunIntegration = startupValidation => !startupValidation.failedPrerequisites.includes('DOCKER_ENGINE_UNAVAILABLE');
const classifyStepExecution = ({ exitCode, timedOut, output = '' }) => {
    const structuredStatusLine = output.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{"status":'));
    if (structuredStatusLine) {
        try {
            const structuredStatus = JSON.parse(structuredStatusLine).status;
            if (structuredStatus === 'BLOCKED') return 'BLOCKED';
            if (structuredStatus === 'FAIL') return 'FAIL';
        } catch (_) { /* Keep the subprocess exit status authoritative when output is malformed. */ }
    }
    return exitCode === 0 && !timedOut ? 'PASS' : 'FAIL';
};
const verificationReceiptStatus = (complete, steps) => {
    if (steps.some(step => step.status === 'FAIL')) return 'FAIL';
    if (steps.some(step => step.status === 'BLOCKED')) return 'BLOCKED';
    return complete ? 'PASS' : 'IN_PROGRESS';
};

const runCapture = (command, args, env, timeoutMs = 20 * 60 * 1000) => new Promise(resolve => {
    const child = spawn(command, args, {
        cwd: BACKEND_ROOT,
        env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const hash = crypto.createHash('sha256');
    let output = '';
    let timedOut = false;
    let timeoutCleanup = null;
    let settled = false;
    let killWatchdog = null;
    let timer;
    const finish = (exitCode, error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killWatchdog);
        resolve({ exitCode: exitCode ?? 1, timedOut, output, outputSha256: hash.digest('hex'), error, timeoutCleanup });
    };
    const keep = chunk => {
        const text = chunk.toString('utf8');
        hash.update(text);
        output = `${output}${text}`.slice(-2_000_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    timer = setTimeout(() => {
        timedOut = true;
        timeoutCleanup = terminateProcessTree(child);
        killWatchdog = setTimeout(() => {
            child.stdout.destroy();
            child.stderr.destroy();
            finish(child.exitCode ?? 1);
        }, 5000);
    }, timeoutMs);
    child.once('error', error => finish(1, error.code || 'PROCESS_START_FAILED'));
    child.once('close', code => finish(code));
});

const runStep = async (name, command, args, env, timeoutMs) => {
    process.stdout.write(`[verify] START ${name}\n`);
    const heartbeat = setInterval(() => process.stdout.write(`[verify] RUNNING ${name}\n`), 45_000);
    const startedAt = new Date().toISOString();
    const execution = await runCapture(command, args, env, timeoutMs);
    clearInterval(heartbeat);
    const step = {
        name,
        status: classifyStepExecution(execution),
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        startedAt,
        completedAt: new Date().toISOString(),
        outputSha256: execution.outputSha256,
        failureCode: execution.error,
        timeoutCleanup: execution.timeoutCleanup,
        summary: execution.output.split(/\r?\n/).filter(line => line.startsWith('Test Suites:')
            || line.startsWith('Tests:') || line.startsWith('Snapshots:')
            || line.startsWith('Time:') || line.includes('Playwright PASS')
            || line.includes('Playwright FAIL')
            || line.startsWith('{"status":')).slice(-8),
    };
    process.stdout.write(`[verify] ${step.status} ${name}\n`);
    return step;
};

const fileSha256 = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const manifestContainsCurrentFileHash = (manifestPath, filePath, repoRoot) => {
    if (!fs.existsSync(manifestPath) || !fs.existsSync(filePath)) return false;
    const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
    const expectedLine = `${fileSha256(filePath)}  ${relativePath}`;
    return fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).includes(expectedLine);
};

const finalizeEvidenceAndRefreshManifest = async ({
    finalizeReceipt,
    refreshProof,
    runPrivacyScan,
    receiptPath,
    archivedProofPath,
    manifestPath,
    repoRoot,
}) => {
    const receipt = finalizeReceipt();
    const proofRefresh = await refreshProof(receipt);
    const privacyScanStep = await runPrivacyScan();
    const manifestCoversReceipt = manifestContainsCurrentFileHash(manifestPath, receiptPath, repoRoot);
    const manifestCoversArchivedProof = manifestContainsCurrentFileHash(manifestPath, archivedProofPath, repoRoot);
    return {
        receiptComplete: receipt?.complete === true,
        proofRefresh,
        privacyScanStep,
        manifestCoversReceipt,
        manifestCoversArchivedProof,
        passed: receipt?.complete === true
            && proofRefresh?.completedReceipt === true
            && proofRefresh?.archiveCreated === true
            && privacyScanStep?.status === 'PASS'
            && privacyScanStep?.exitCode === 0
            && manifestCoversReceipt
            && manifestCoversArchivedProof,
    };
};

const findCandidateRealGeminiRunId = ({ comparisonRoot, sourceSha256, oracleSha256, backendSourceSha256: candidateSourceSha256, runnerSourceSha256 }) => {
    if (typeof comparisonRoot !== 'string' || !path.isAbsolute(comparisonRoot)
        || typeof sourceSha256 !== 'string' || typeof oracleSha256 !== 'string'
        || typeof candidateSourceSha256 !== 'string' || typeof runnerSourceSha256 !== 'string'
        || !fs.existsSync(comparisonRoot)) return null;
    const artifactRoot = path.resolve(path.dirname(comparisonRoot));
    const currentRunnerArtifact = entry => {
        const relativePath = entry?.artifactPath;
        if (typeof relativePath !== 'string') return false;
        const target = path.resolve(artifactRoot, relativePath);
        if (!target.startsWith(`${artifactRoot}${path.sep}`) || !fs.existsSync(target)) return false;
        try { return JSON.parse(fs.readFileSync(target, 'utf8')).runnerSourceSha256 === runnerSourceSha256; } catch (_) { return false; }
    };
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
            && typeof entry.candidate.summary?.runId === 'string'
            && currentRunnerArtifact(entry.candidate))
        .sort((left, right) => String(right.candidate.completedAt || '').localeCompare(String(left.candidate.completedAt || '')))
        .map(entry => entry.candidate.summary.runId)[0] || null;
};

const requiredEnv = () => {
    const env = { ...process.env };
    for (const key of [
        'EM-GEMINI-KEY', 'EM_GEMINI_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY', 'EASYMOD_LIVE_GEMINI_EGRESS', 'LAB_REAL_GEMINI_RUN_ID',
        'LAB_GEMINI_PRO_PHOTO_PROBE', 'LAB_PRO_PHOTO_CAMPAIGN_ID', 'LAB_PRO_PHOTO_RESULT_PATH',
        'LAB_GEMINI_LITE_PHOTO_DIAGNOSTIC', 'LAB_GEMINI_LITE_PHOTO_CAMPAIGN_ID',
        'LAB_GEMINI_LITE_PHOTO_RESULT_PATH', 'LAB_RUN_GENUINE_PHOTO_EVAL', 'LAB_RUN_SYNTHETIC_VISION',
    ]) delete env[key];
    env.NODE_ENV = 'test';
    env.LAB_RUN_MODE = 'offline';
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
    if (shouldRequireDockerEngine(process.env)) {
        const docker = dockerInfo();
        if (docker.status !== 0 || !String(docker.stdout || '').trim()) validation.push('DOCKER_ENGINE_UNAVAILABLE');
    }
    const paidGeminiKey = resolvePaidGeminiKey(process.env);
    if (paidOptIn && !paidGeminiKey) validation.push('EM_GEMINI_KEY_UNAVAILABLE');
    const startupValidation = partitionStartupValidation(validation);
    if (startupValidation.blocking.length) {
        process.stderr.write(`[verify] BLOCKED ${startupValidation.blocking.join(',')}\n`);
        process.exitCode = 1;
        return;
    }
    if (startupValidation.failedPrerequisites.length) {
        process.stderr.write(`[verify] CONTINUING WITH FAILED LOCAL DEPENDENCIES ${startupValidation.failedPrerequisites.join(',')}\n`);
    }

    fs.mkdirSync(path.join(ARTIFACT_ROOT, 'security'), { recursive: true });
    fs.mkdirSync(path.join(ARTIFACT_ROOT, 'regression'), { recursive: true });
    const runId = crypto.randomUUID();
    const receiptPath = path.join(ARTIFACT_ROOT, 'regression', `verify-${runId}.json`);
    const steps = startupValidation.failedPrerequisites.map(failureCode => ({
        name: 'docker-engine-preflight',
        status: 'BLOCKED',
        exitCode: 1,
        timedOut: false,
        startedAt,
        completedAt: new Date().toISOString(),
        outputSha256: null,
        failureCode,
        timeoutCleanup: null,
        summary: ['Docker is unavailable; independent automated QA stages continue.'],
    }));
    let realGeminiCandidateRunId = null;
    const offline = requiredEnv();
    const writeReceiptSnapshot = complete => {
        const receipt = {
            schemaVersion: 1,
            runId,
            status: verificationReceiptStatus(complete, steps),
            complete,
            mode: paidOptIn ? 'PAID_OPT_IN' : 'OFFLINE_DEFAULT',
            startedAt,
            completedAt: complete ? new Date().toISOString() : null,
            nodeVersion: process.versions.node,
            candidateCommit,
            candidateBranch,
            candidateBackendSourceSha256,
            realGeminiCandidateRunId,
            worktreeCleanAtStart,
            baselineSha: BASELINE_SHA,
            sourceCorpusSha256: EXPECTED_SOURCE_SHA256,
            providerCallsAllowedByEntrypoint: paidOptIn,
            providerBudgetCapUsd: paidOptIn ? 2 : 0,
            steps: [...steps],
        };
        fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        return receipt;
    };
    writeReceiptSnapshot(false);
    offline.LAB_VERIFY_RECEIPT_PATH = receiptPath;

    steps.push(await runStep('source-oracle-preparation', NODE, [path.join(__dirname, 'benchmark-oracle.js')], offline));
    steps.push(await runStep('held-out-fixture-preparation', NODE, [path.join(__dirname, 'generate-heldout-benchmark.js')], offline));
    const heldoutOracleEnv = {
        ...offline,
        LAB_DATASET_PATH: path.join(ARTIFACT_ROOT, 'benchmarks', 'heldout-customer-questions.csv'),
        LAB_ORACLE_PATH: path.join(ARTIFACT_ROOT, 'benchmarks', 'heldout-customer-truth-oracle.json'),
    };
    steps.push(await runStep('held-out-oracle-preparation', NODE, [path.join(__dirname, 'benchmark-oracle.js')], heldoutOracleEnv));
    if (canRunIntegration(startupValidation)) {
        steps.push(await runStep('postgres-redis-worker-webhook-and-full-backend-regression', NODE, [path.join(__dirname, 'run-integration.js')], offline, 50 * 60 * 1000));
    } else {
        steps.push({
            name: 'postgres-redis-worker-webhook-and-full-backend-regression',
            status: 'BLOCKED',
            exitCode: null,
            timedOut: false,
            startedAt,
            completedAt: new Date().toISOString(),
            outputSha256: null,
            failureCode: 'DOCKER_ENGINE_UNAVAILABLE',
            timeoutCleanup: null,
            summary: ['No Compose project was started and no existing external service was contacted.'],
        });
    }
    const securityEnv = { ...offline, GROWTH_OS_ENABLED: 'false' };
    const securityScript = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8')).scripts['test:security'];
    const securityReportPath = path.join(os.tmpdir(), `product-v13-security-${crypto.randomUUID()}.json`);
    const securityArgs = [
        ...securityScript.split(/\s+/).slice(1),
        '--forceExit', '--detectOpenHandles', '--json', `--outputFile=${securityReportPath}`,
    ];
    const securityStep = await runStep('backend-security-suite', NODE, [path.join(BACKEND_ROOT, 'node_modules', 'jest', 'bin', 'jest.js'), ...securityArgs], securityEnv, 45 * 60 * 1000);
    try {
        const report = JSON.parse(fs.readFileSync(securityReportPath, 'utf8'));
        securityStep.summary = [...securityStep.summary, JSON.stringify({
            status: report.numFailedTests === 0 && report.numFailedTestSuites === 0 ? 'PASS' : 'FAIL',
            passedSuites: report.numPassedTestSuites ?? null,
            failedSuites: report.numFailedTestSuites ?? null,
            passedTests: report.numPassedTests ?? null,
            failedTests: report.numFailedTests ?? null,
        })].slice(-8);
    } catch (_) {
        // A timeout or an early Jest failure may not produce a structured report.
    } finally {
        try { fs.unlinkSync(securityReportPath); } catch (_) { }
    }
    steps.push(securityStep);

    for (const dataset of ['source', 'heldout']) {
        const env = { ...offline, LAB_COMPARISON_MODE: 'deterministic', LAB_COMPARISON_DATASET: dataset, LAB_RUN_SCOPE: 'full' };
        steps.push(await runStep(`deterministic-${dataset}-comparison`, NODE, [path.join(__dirname, 'run-engine-comparison.js')], env, 15 * 60 * 1000));
    }

    if (paidOptIn) {
        const paidEnv = { ...offline, 'EM-GEMINI-KEY': paidGeminiKey,
            LAB_COMPARISON_MODE: 'real-gemini', LAB_COMPARISON_DATASET: 'source', LAB_RUN_SCOPE: 'full' };
        const paidComparison = await runStep('paid-gemini-source-and-genuine-photo-comparison-cap-usd-2', NODE, [path.join(__dirname, 'run-engine-comparison.js')], paidEnv, 35 * 60 * 1000);
        steps.push(paidComparison);
    } else {
        steps.push({ name: 'paid-gemini-source-and-genuine-photo-comparison', status: 'NOT_RUN_OFFLINE_DEFAULT' });
    }

    if (!paidOptIn || steps.find(step => step.name === 'paid-gemini-source-and-genuine-photo-comparison-cap-usd-2')?.status === 'PASS') {
        try {
            const oraclePath = path.join(ARTIFACT_ROOT, 'benchmarks', 'customer-truth-oracle.json');
            const oracleSha256 = JSON.parse(fs.readFileSync(oraclePath, 'utf8')).oracleSha256;
            realGeminiCandidateRunId = findCandidateRealGeminiRunId({
                comparisonRoot: path.join(ARTIFACT_ROOT, 'comparisons'),
                sourceSha256: EXPECTED_SOURCE_SHA256,
                oracleSha256,
                backendSourceSha256: candidateBackendSourceSha256,
                runnerSourceSha256: require('./lab-server').getSourceProvenance().runnerSourceSha256,
            });
        } catch (_) { realGeminiCandidateRunId = null; }
    }

    steps.push({
        name: 'paid-gemini-candidate-run-discovery',
        status: realGeminiCandidateRunId ? 'PASS'
            : paidOptIn ? 'FAIL' : 'NOT_RUN_OFFLINE_DEFAULT',
        exitCode: realGeminiCandidateRunId ? 0 : paidOptIn ? 1 : null,
        timedOut: false,
        summary: realGeminiCandidateRunId
            ? ['Matched a current paid source comparison to its candidate run.']
            : paidOptIn ? ['No valid current paid candidate run could be matched.']
                : ['No current paid candidate run was available for browser verification.'],
    });

    const playwrightEnv = realGeminiCandidateRunId
        ? { ...offline, LAB_REAL_GEMINI_RUN_ID: realGeminiCandidateRunId }
        : offline;
    steps.push(await runStep('local-test-lab-playwright', NODE, [path.join(__dirname, 'run-lab-playwright.js')], playwrightEnv, PLAYWRIGHT_GATE_TIMEOUT_MS));
    steps.push(await runStep('privacy-scanner-unit-tests', 'python', [path.join(__dirname, 'test_scan_artifact_privacy.py')], offline));
    steps.push(await runStep('trace-sanitizer-unit-tests', 'python', [path.join(__dirname, 'test_sanitize_playwright_traces.py')], offline));
    const traceSanitizationOutput = path.join(ARTIFACT_ROOT, 'security', 'playwright-trace-sanitization.json');
    steps.push(await runStep('playwright-trace-sanitization', 'python', [
        path.join(__dirname, 'sanitize-playwright-traces.py'),
        '--csv', SOURCE_CSV,
        '--artifacts', path.join(ARTIFACT_ROOT, 'playwright'),
        '--output', traceSanitizationOutput,
    ], offline, 10 * 60 * 1000));

    const privacyOutput = path.join(ARTIFACT_ROOT, 'security', 'artifact-privacy-scan.json');
    const privacyManifest = path.join(ARTIFACT_ROOT, 'security', 'artifact-checksum-manifest.txt');
    const privacyScanArgs = [
        path.join(__dirname, 'scan-artifact-privacy.py'),
        '--csv', SOURCE_CSV,
        '--artifacts', ARTIFACT_ROOT,
        '--output', privacyOutput,
        '--manifest', privacyManifest,
    ];
    steps.push(await runStep('artifact-privacy-scan-and-checksum-manifest', 'python', privacyScanArgs, offline, 10 * 60 * 1000));

    const generator = path.join(__dirname, 'generate-product-engine-v1-3-proof.js');
    writeReceiptSnapshot(false);
    const proofStep = await runStep('consolidated-cost-and-proof-generation', NODE, [generator], offline, 60_000);
    const proofMarkdownPath = path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-3', 'PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md');
    const archivedProofMarkdownPath = path.join(ARTIFACT_ROOT, 'reports', 'product-engine-v1.3-proof.md');
    try {
        if (!fs.existsSync(proofMarkdownPath)) throw new Error('Proof Markdown is missing.');
        fs.mkdirSync(path.dirname(archivedProofMarkdownPath), { recursive: true });
        fs.copyFileSync(proofMarkdownPath, archivedProofMarkdownPath);
        proofStep.proofMarkdownArchive = { status: 'PASS', path: archivedProofMarkdownPath };
    } catch (_) {
        proofStep.proofMarkdownArchive = { status: 'FAIL' };
        proofStep.status = 'FAIL';
        proofStep.failureCode = proofStep.failureCode || 'PROOF_MARKDOWN_ARCHIVE_FAILED';
    }
    steps.push(proofStep);
    steps.push(await runStep('final-artifact-privacy-scan-and-checksum-manifest', 'python', privacyScanArgs, offline, 10 * 60 * 1000));

    const finalization = await finalizeEvidenceAndRefreshManifest({
        finalizeReceipt: () => writeReceiptSnapshot(true),
        refreshProof: async receipt => {
            const refreshedProofStep = await runStep('completed-receipt-proof-refresh', NODE, [generator], offline, 60_000);
            let completedReceipt = false;
            let archiveCreated = false;
            try {
                if (!fs.existsSync(proofMarkdownPath)) throw new Error('Completed-receipt proof Markdown is missing.');
                const proofJsonPath = path.join(ARTIFACT_ROOT, 'product-engine-v1.3-proof.json');
                const proof = JSON.parse(fs.readFileSync(proofJsonPath, 'utf8'));
                completedReceipt = proof.verificationEntryPoint?.complete === true
                    && proof.verificationEntryPoint?.runId === receipt.runId
                    && proof.verificationEntryPoint?.candidateCommit === candidateCommit;
                if (!completedReceipt) throw new Error('Generated proof does not reference the completed verifier receipt.');
                fs.mkdirSync(path.dirname(archivedProofMarkdownPath), { recursive: true });
                fs.copyFileSync(proofMarkdownPath, archivedProofMarkdownPath);
                archiveCreated = fileSha256(proofMarkdownPath) === fileSha256(archivedProofMarkdownPath);
                if (!archiveCreated) throw new Error('Archived proof does not match generated proof Markdown.');
                refreshedProofStep.proofMarkdownArchive = { status: 'PASS', path: archivedProofMarkdownPath };
            } catch (_) {
                refreshedProofStep.proofMarkdownArchive = { status: 'FAIL' };
                refreshedProofStep.failureCode = refreshedProofStep.failureCode || 'COMPLETED_PROOF_MARKDOWN_ARCHIVE_FAILED';
            }
            return { runnerStep: refreshedProofStep, completedReceipt, archiveCreated };
        },
        runPrivacyScan: () => runStep('post-completion-artifact-privacy-scan-and-checksum-manifest', 'python', privacyScanArgs, offline, 10 * 60 * 1000),
        receiptPath,
        archivedProofPath: archivedProofMarkdownPath,
        manifestPath: privacyManifest,
        repoRoot: REPO_ROOT,
    });
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    process.stdout.write(`[verify] ${finalization.passed ? 'PASS' : 'FAIL'} post-completion-evidence-finalization receipt=${finalization.receiptComplete ? 'COMPLETE' : 'INCOMPLETE'} manifestReceipt=${finalization.manifestCoversReceipt ? 'MATCH' : 'MISMATCH'} manifestArchivedProof=${finalization.manifestCoversArchivedProof ? 'MATCH' : 'MISMATCH'}\n`);
    process.stdout.write(`[verify] ${receipt.status} mode=${receipt.mode} receipt=${receiptPath}\n`);
    if (receipt.status !== 'PASS' || !finalization.passed) process.exitCode = 1;
};

if (require.main === module) main().catch(() => {
    process.stderr.write('[verify] FAIL VERIFICATION_ENTRYPOINT_ERROR\n');
    process.exitCode = 1;
});

module.exports = { canRunIntegration, classifyStepExecution, dockerInfo, finalizeEvidenceAndRefreshManifest, findCandidateRealGeminiRunId, manifestContainsCurrentFileHash, partitionStartupValidation, requiredEnv, resolvePaidGeminiKey, runCapture, shouldRequireDockerEngine, verificationReceiptStatus };
