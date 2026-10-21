'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { getSourceProvenance } = require('./lab-server');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');
const ARTIFACT_ROOT = path.resolve(process.env.LAB_ARTIFACT_ROOT
    || path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-3', 'artifacts'));
const RUN_ROOT = path.join(ARTIFACT_ROOT, 'runs');
const COMPARISON_ROOT = path.join(ARTIFACT_ROOT, 'comparisons');
const BASELINE_SHA = '957bb991a18db1949369a6f805822b8c8b69889b';
const JEST = path.join(BACKEND_ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
const JEST_CONFIG = path.join(BACKEND_ROOT, 'jest.product-engine-v1-3.config.js');
const REPLAY_TEST = path.join(BACKEND_ROOT, 'scripts', 'product-experience', 'lab-replay.test.js');
const V13_CAMPAIGN_ID = 'v13-cf6f18b2-2a9a-4831-ad42-2b8509bfcd35';
const V13_CAMPAIGN_MAX_REQUESTS = 256;
const V13_CAMPAIGN_MAX_VISION_REQUESTS = 12;
const textHash = value => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = filename => textHash(fs.readFileSync(filename));
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const parseSummary = output => ({
    testSuites: output.match(/Test Suites:\s+([^\r\n]+)/)?.[1] || 'unavailable',
    tests: output.match(/Tests:\s+([^\r\n]+)/)?.[1] || 'unavailable',
    duration: output.match(/Time:\s+([^\r\n]+)/)?.[1] || 'unavailable',
});

const hashBackendSourceTree = engineRoot => {
    const sourceRoot = path.join(engineRoot, 'src');
    const files = [];
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(filename);
            else if (entry.isFile() && !entry.name.startsWith('intent-router.lab-baseline-')) files.push(filename);
        }
    };
    visit(sourceRoot);
    const relative = filename => path.relative(sourceRoot, filename).replace(/\\/g, '/');
    files.sort((left, right) => {
        const a = relative(left);
        const b = relative(right);
        return a < b ? -1 : a > b ? 1 : 0;
    });
    const digest = crypto.createHash('sha256');
    for (const filename of files) digest.update(relative(filename), 'utf8').update('\0').update(fs.readFileSync(filename)).update('\0');
    return digest.digest('hex');
};

const cleanWindowsEnv = () => ({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
});

const runJest = (args, env, timeoutMs) => new Promise(resolve => {
    const child = spawn(process.execPath, [JEST, '--config', JEST_CONFIG, '--runInBand', '--runTestsByPath', REPLAY_TEST, '--coverage=false'], {
        cwd: BACKEND_ROOT,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const keepTail = (current, chunk) => `${current}${chunk.toString('utf8')}`.slice(-2_000_000);
    child.stdout.on('data', chunk => { stdout = keepTail(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = keepTail(stderr, chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once('error', error => {
        clearTimeout(timer);
        resolve({ code: 1, timedOut: false, stdout, stderr, errorCode: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'PROCESS_START_FAILED' });
    });
    child.once('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, signal: signal || null, timedOut, stdout, stderr, errorCode: null });
    });
});

const summarizeArtifact = artifact => ({
    runId: artifact.runId,
    engineVariant: artifact.engineVariant,
    engineSourceRevision: artifact.engineSourceRevision,
    engineSourceSha256: artifact.engineSourceSha256,
    sourceSha256: artifact.dataset.sha256,
    sourceTurns: artifact.dataset.sourceTurns,
    sourcePersonas: artifact.dataset.sourcePersonas,
    executedTurns: artifact.dataset.executedTurns,
    catalogFixtureStatus: artifact.catalogFixtureIntegrity?.status || 'MISSING',
    catalogProjectionSha256: artifact.catalogFixtureIntegrity?.actualProjectionSha256 || null,
    oracleSha256: artifact.benchmarkOracle?.oracleSha256 || null,
    answerableProductTurns: artifact.summary.sourceAnswerableProductTurns,
    evaluatedAnswerableProductTurns: artifact.summary.evaluatedAnswerableProductTurns,
    verifiedCorrectAnswers: artifact.summary.correctVerifiedProductAnswers,
    verifiedCorrectTurns: artifact.summary.correctVerifiedProductTurns,
    eligibleFactSlots: artifact.summary.sourceEligibleProductFactSlots,
    evaluatedFactSlots: artifact.summary.evaluatedEligibleProductFactSlots,
    falseRefusalSlots: artifact.summary.unnecessaryRefusalSlots,
    unsupportedClaimsSent: artifact.summary.unsupportedClaimsSent,
    contextDependentAnswerableTurns: artifact.summary.contextDependentAnswerableTurns,
    contextResolutionFailures: artifact.summary.contextResolutionFailures,
    crossDomainHandoffTurns: artifact.summary.crossDomainHandoffTurns,
    safeCrossDomainHandoffs: artifact.summary.safeCrossDomainHandoffs,
    unsafeCrossDomainHandoffs: artifact.summary.unsafeCrossDomainHandoffs,
    safeFallbacks: artifact.summary.safeFallbacks,
    crossDomainHandoffRequests: artifact.turns.reduce((sum, turn) => sum + (turn.oracle.crossDomainHandoffs?.length || 0), 0),
    textRequests: artifact.summary.realGeminiTextCalls,
    visionRequests: artifact.summary.realGeminiVisionCalls,
    estimatedProviderChargeUsd: artifact.evaluationBudget?.estimatedProviderChargeUsd ?? null,
    unpricedProviderCalls: artifact.performance.unpricedProviderCalls,
    p50RouteMs: artifact.performance.p50Ms,
    p95RouteMs: artifact.performance.p95Ms,
    p50ProviderMs: artifact.performance.providerP50Ms,
    p95ProviderMs: artifact.performance.providerP95Ms,
    businessMutations: artifact.summary.businessMutations,
    messengerSends: artifact.summary.messengerSends,
    tenantViolations: artifact.summary.tenantScopeViolations,
    unscopedReads: artifact.summary.unscopedCatalogReads,
});

const outcome = (baseline, candidate, direction) => {
    if (baseline == null || candidate == null) return 'INCONCLUSIVE';
    if (baseline === candidate) return 'EQUIVALENT';
    if (direction === 'higher') return candidate > baseline ? 'IMPROVED' : 'REGRESSED';
    return candidate < baseline ? 'IMPROVED' : 'REGRESSED';
};

const main = async () => {
    const mode = process.env.LAB_COMPARISON_MODE || 'deterministic';
    const datasetName = process.env.LAB_COMPARISON_DATASET || 'source';
    const scope = process.env.LAB_RUN_SCOPE || 'full';
    const personaId = process.env.LAB_PERSONA_ID || '';
    if (!['deterministic', 'real-gemini'].includes(mode) || !['source', 'heldout'].includes(datasetName)) {
        throw new Error('Choose comparison mode deterministic/real-gemini and dataset source/heldout.');
    }
    if (!['full', 'persona'].includes(scope) || (scope === 'persona' && !/^P(?:0[1-9]|1\d|20)$/.test(personaId))) {
        throw new Error('Comparison replay scope is invalid.');
    }
    if (mode === 'real-gemini' && datasetName !== 'source') throw new Error('Paid source-corpus evaluation uses the original 200 turns; held-out evaluation remains offline.');
    if (mode === 'real-gemini' && (typeof process.env['EM-GEMINI-KEY'] !== 'string' || !process.env['EM-GEMINI-KEY'].trim())) {
        throw new Error('Process-scoped EM-GEMINI-KEY is unavailable; no provider request was made.');
    }

    const baselineBackend = path.resolve(process.env.LAB_BASELINE_ENGINE_ROOT
        || path.join(WORKSPACE_ROOT, '_wt-verified-commerce-v1-2', 'EasyMod-backend'));
    const candidateBackend = BACKEND_ROOT;
    if (git(path.dirname(baselineBackend), 'rev-parse', 'HEAD') !== BASELINE_SHA) throw new Error('Frozen V1.2 worktree does not match the required baseline SHA.');
    if (git(REPO_ROOT, 'rev-parse', 'HEAD').length !== 40) throw new Error('Candidate engine revision is unavailable.');
    const sourcePath = datasetName === 'source'
        ? path.join(WORKSPACE_ROOT, 'customer-simulator.csv')
        : path.join(ARTIFACT_ROOT, 'benchmarks', 'heldout-customer-questions.csv');
    const oraclePath = datasetName === 'source'
        ? path.join(ARTIFACT_ROOT, 'benchmarks', 'customer-truth-oracle.json')
        : path.join(ARTIFACT_ROOT, 'benchmarks', 'heldout-customer-truth-oracle.json');
    if (!fs.existsSync(sourcePath) || !fs.existsSync(oraclePath)) throw new Error('Source dataset or pre-frozen independent oracle is missing.');
    const inputSha256 = fileHash(sourcePath);
    const oracleArtifact = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
    if (oracleArtifact.source?.sha256 !== inputSha256 || oracleArtifact.source?.turns !== 200) throw new Error('Frozen oracle does not match the selected 200-turn input.');
    const oracleSha256 = textHash(JSON.stringify(oracleArtifact.turns));
    if (oracleArtifact.oracleSha256 !== oracleSha256) throw new Error('Frozen oracle checksum is invalid.');

    const baselineRevision = git(path.dirname(baselineBackend), 'rev-parse', 'HEAD');
    const candidateRevision = git(REPO_ROOT, 'rev-parse', 'HEAD');
    // Keep simulated turn timestamps close to the runner clock. V1.2 does not
    // accept an injected clock, so a future fixed date would make its context
    // TTL reject otherwise valid history and invalidate the comparison.
    const evaluationClockMs = Number(process.env.LAB_EVALUATION_CLOCK_MS || Date.now());
    if (!Number.isSafeInteger(evaluationClockMs) || evaluationClockMs < 0) throw new Error('Matched comparison clock is invalid.');
    const runnerProvenance = getSourceProvenance();
    const campaignId = mode === 'real-gemini' ? (process.env.LAB_CAMPAIGN_ID || V13_CAMPAIGN_ID) : null;
    const campaignLedgerPath = campaignId ? path.join(ARTIFACT_ROOT, 'campaigns', campaignId, 'budget-ledger.json') : null;
    const campaignCeilingUsd = 2;
    if (mode === 'real-gemini') {
        if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(campaignId)) throw new Error('V1.3 campaign ID is invalid.');
        const { createEvaluationCampaignLedger } = require('./evaluation-campaign-ledger');
        const campaignLedger = createEvaluationCampaignLedger({
            ledgerPath: campaignLedgerPath,
            campaignId,
            ceilingUsd: campaignCeilingUsd,
            maxRequests: V13_CAMPAIGN_MAX_REQUESTS,
            maxVisionRequests: V13_CAMPAIGN_MAX_VISION_REQUESTS,
        });
        const prior = campaignLedger.snapshot();
        if (prior.requestCount >= V13_CAMPAIGN_MAX_REQUESTS
            || prior.visionRequestCount >= V13_CAMPAIGN_MAX_VISION_REQUESTS
            || prior.reservedWorstCaseUsd >= campaignCeilingUsd) {
            throw new Error('Cumulative V1.3 campaign budget is exhausted.');
        }
    }
    const engineTargets = [
        { name: 'baseline-v1-2', backendRoot: baselineBackend, revision: baselineRevision },
        { name: 'candidate-v1-3', backendRoot: candidateBackend, revision: candidateRevision },
    ];
    fs.mkdirSync(RUN_ROOT, { recursive: true });
    fs.mkdirSync(COMPARISON_ROOT, { recursive: true });

    const results = [];
    for (const engine of engineTargets) {
        const engineHash = hashBackendSourceTree(engine.backendRoot);
        const runId = crypto.randomUUID();
        const artifactPath = path.join(RUN_ROOT, `${runId}.json`);
        const progressPath = path.join(RUN_ROOT, `${runId}.progress.json`);
        const stage = `${engine.name}-${datasetName}-${mode}-${runId}`;
        const env = {
            ...cleanWindowsEnv(),
            NODE_ENV: 'test',
            NODE_OPTIONS: '',
            NODE_PATH: path.join(BACKEND_ROOT, 'node_modules'),
            LAB_ARTIFACT_ROOT: ARTIFACT_ROOT,
            LAB_ENGINE_ROOT: engine.backendRoot,
            LAB_ENGINE_LABEL: engine.name,
            LAB_RUN_ID: runId,
            LAB_RUN_SCOPE: scope,
            LAB_PERSONA_ID: personaId,
            LAB_RUN_MODE: mode === 'real-gemini' ? 'real-gemini' : 'candidate',
            LAB_RESULT_PATH: artifactPath,
            LAB_PROGRESS_PATH: progressPath,
            LAB_DATASET_PATH: sourcePath,
            LAB_ORACLE_PATH: oraclePath,
            LAB_CATALOG_FIXTURE: 'v1.2-two-tenant',
            LAB_EVALUATION_CLOCK_MS: String(evaluationClockMs),
            LAB_RUN_GENUINE_PHOTO_EVAL: mode === 'real-gemini' ? '1' : '0',
            LAB_RUN_SYNTHETIC_VISION: '0',
            LAB_SOURCE_REVISION: engine.revision,
            LAB_ENGINE_SOURCE_REVISION: `${engine.revision}+backend-src-sha256:${engineHash}`,
            LAB_ENGINE_SOURCE_SHA256: engineHash,
            LAB_RUNNER_REVISION: runnerProvenance.runnerRevision,
            LAB_RUNNER_SOURCE_SHA256: runnerProvenance.runnerSourceSha256,
        };
        if (mode === 'real-gemini') {
            env['EM-GEMINI-KEY'] = process.env['EM-GEMINI-KEY'];
            env.EASYMOD_LIVE_GEMINI_EGRESS = '1';
            env.LAB_CAMPAIGN_ID = campaignId;
            env.LAB_CAMPAIGN_LEDGER_PATH = campaignLedgerPath;
            env.LAB_CAMPAIGN_STAGE = stage;
            env.LAB_CAMPAIGN_CEILING_USD = String(campaignCeilingUsd);
            env.LAB_CAMPAIGN_MAX_REQUESTS = String(V13_CAMPAIGN_MAX_REQUESTS);
            env.LAB_CAMPAIGN_MAX_VISION_REQUESTS = String(V13_CAMPAIGN_MAX_VISION_REQUESTS);
        } else {
            env.EASYMOD_LIVE_GEMINI_EGRESS = '0';
            env.LAB_CAMPAIGN_ID = '';
        }
        const startedAt = new Date().toISOString();
        const execution = await runJest([], env, mode === 'real-gemini' ? 1_800_000 : 600_000);
        let artifact = null;
        if (fs.existsSync(artifactPath)) {
            try { artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')); } catch (_) { artifact = null; }
        }
        try { if (fs.existsSync(progressPath)) fs.unlinkSync(progressPath); } catch (_) { }
        const result = {
            engine: engine.name,
            stage,
            status: execution.code === 0 && artifact?.status === 'completed' ? 'PASS' : 'FAIL',
            exitCode: execution.code,
            timedOut: execution.timedOut,
            startedAt,
            completedAt: new Date().toISOString(),
            sourceRevision: engine.revision,
            engineSourceSha256: engineHash,
            artifactPath: artifact ? path.relative(ARTIFACT_ROOT, artifactPath).replace(/\\/g, '/') : null,
            artifactSha256: artifact ? fileHash(artifactPath) : null,
            jest: parseSummary(`${execution.stdout}\n${execution.stderr}`),
            outputSha256: textHash(`${execution.stdout}\n${execution.stderr}`),
            errorCode: execution.errorCode,
            summary: artifact ? summarizeArtifact(artifact) : null,
        };
        results.push(result);
        process.stdout.write(JSON.stringify({ status: result.status, engine: result.engine, stage, exitCode: result.exitCode, summary: result.summary }) + '\n');
    }

    const byEngine = Object.fromEntries(results.map(result => [result.engine, result.summary]));
    const baseline = byEngine['baseline-v1-2'];
    const candidate = byEngine['candidate-v1-3'];
    const sameDenominator = Boolean(baseline && candidate
        && baseline.sourceSha256 === candidate.sourceSha256
        && baseline.oracleSha256 === candidate.oracleSha256
        && baseline.catalogFixtureStatus === 'PASS'
        && candidate.catalogFixtureStatus === 'PASS'
        && baseline.catalogProjectionSha256 === candidate.catalogProjectionSha256
        && baseline.answerableProductTurns === candidate.answerableProductTurns
        && baseline.eligibleFactSlots === candidate.eligibleFactSlots);
    const proof = {
        schemaVersion: 1,
        comparisonId: crypto.randomUUID(),
        mode,
        dataset: datasetName,
        baselineCommit: baselineRevision,
        candidateCommit: candidateRevision,
        baselineEngineRoot: baselineBackend,
        candidateEngineRoot: candidateBackend,
        datasetSha256: inputSha256,
        oracleArtifactSha256: fileHash(oraclePath),
        oracleSha256,
        catalogFixtureSha256: oracleArtifact.catalog.sha256,
        evaluationClock: new Date(evaluationClockMs).toISOString(),
        sameDenominator,
        comparisonValid: sameDenominator && results.every(result => result.status === 'PASS')
            && results.every(result => result.summary?.catalogFixtureStatus === 'PASS')
            && results.every(result => result.summary?.executedTurns === (scope === 'full' ? 200 : 10)),
        model: mode === 'real-gemini' ? 'gemini-3.1-flash-lite' : null,
        campaignId,
        campaignLedgerPath: campaignLedgerPath ? path.relative(ARTIFACT_ROOT, campaignLedgerPath).replace(/\\/g, '/') : null,
        providerBudgetUsd: mode === 'real-gemini' ? campaignCeilingUsd : 0,
        results,
        metricOutcomes: baseline && candidate ? {
            verifiedCorrectAnswers: outcome(baseline.verifiedCorrectAnswers, candidate.verifiedCorrectAnswers, 'higher'),
            falseRefusalSlots: outcome(baseline.falseRefusalSlots, candidate.falseRefusalSlots, 'lower'),
            unsupportedClaimsSent: outcome(baseline.unsupportedClaimsSent, candidate.unsupportedClaimsSent, 'lower'),
            contextResolutionFailures: outcome(baseline.contextResolutionFailures, candidate.contextResolutionFailures, 'lower'),
            safeCrossDomainHandoffs: outcome(baseline.safeCrossDomainHandoffs, candidate.safeCrossDomainHandoffs, 'higher'),
            p95RouteMs: outcome(baseline.p95RouteMs, candidate.p95RouteMs, 'lower'),
            estimatedProviderChargeUsd: outcome(baseline.estimatedProviderChargeUsd, candidate.estimatedProviderChargeUsd, 'lower'),
        } : null,
        providerInvoice: mode === 'real-gemini' ? 'NOT_AVAILABLE' : 'NOT_APPLICABLE',
        productionChanged: false,
        metaSends: 0,
        databaseWrites: 0,
    };
    const filename = `${mode}-${datasetName}-${proof.comparisonId}.json`;
    const proofPath = path.join(COMPARISON_ROOT, filename);
    fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({
        status: proof.comparisonValid ? 'PASS' : 'FAIL',
        mode, dataset: datasetName, sameDenominator,
        comparisonValid: proof.comparisonValid,
        proofPath,
        results: results.map(result => ({ engine: result.engine, status: result.status, exitCode: result.exitCode })),
    }) + '\n');
    if (!proof.comparisonValid) process.exitCode = 1;
};

main().catch(error => {
    const message = /^[A-Z0-9_ -]{1,160}$/.test(String(error?.message || ''))
        ? error.message : 'ENGINE_COMPARISON_FAILED';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
