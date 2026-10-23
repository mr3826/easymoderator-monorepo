'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
    REQUIRED_CASE_COUNT,
    USEFULNESS_RUBRIC_VERSION,
    SYSTEM_PROMPT,
    CROSSCHECK_SYSTEM_PROMPT,
    buildUsefulnessCases,
    buildBlindedJudgeInput,
    parseJudgeResponse,
    selectJudgeConsistencyCases,
    summarizeJudgeConsistency,
    summarizeUsefulnessResults,
} = require('./semantic-usefulness');
const {
    createEvaluationBudget,
    GEMINI_PRICE_SNAPSHOT,
    GEMINI_PRO_PRICE_SNAPSHOT,
} = require('./evaluation-budget');
const { createEvaluationCampaignLedger } = require('./evaluation-campaign-ledger');
const { createGeminiEvaluationClient } = require('./gemini-evaluation-client');
const { getSourceProvenance } = require('./lab-server');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const ARTIFACT_ROOT = path.resolve(process.env.LAB_ARTIFACT_ROOT || path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-3', 'artifacts'));
const PRIMARY_MODEL = GEMINI_PRICE_SNAPSHOT.model;
const CONSISTENCY_MODEL = GEMINI_PRO_PRICE_SNAPSHOT.model;
const CEILING_USD = 0.85;
const MAX_REQUESTS = 230;
const MAX_INPUT_TOKENS = 4096;
const MAX_OUTPUT_TOKENS = 512;
const PRIMARY_STAGE = 'blinded-usefulness-flash-lite-v2';
const CONSISTENCY_STAGE = 'blinded-usefulness-pro-consistency-v2';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
const fail = code => {
    const error = new Error(code);
    error.code = code;
    return error;
};

const inside = (root, candidate) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const readMatchedRun = (result, artifactRoot) => {
    if (!result || result.status !== 'PASS' || !result.artifactPath || !/^[a-f0-9]{64}$/.test(result.artifactSha256 || '')) {
        throw fail('COMPARISON_RUN_NOT_PASSED');
    }
    const filename = path.resolve(artifactRoot, result.artifactPath.split('/').join(path.sep));
    if (!inside(artifactRoot, filename) || !fs.existsSync(filename)) throw fail('COMPARISON_RUN_PATH_INVALID');
    const bytes = fs.readFileSync(filename);
    if (sha256(bytes) !== result.artifactSha256) throw fail('COMPARISON_RUN_HASH_MISMATCH');
    const run = JSON.parse(bytes.toString('utf8'));
    if (run.status !== 'completed' || !Array.isArray(run.turns) || run.turns.length !== REQUIRED_CASE_COUNT) {
        throw fail('COMPARISON_RUN_INCOMPLETE');
    }
    return { run, sha256: result.artifactSha256 };
};

const loadMatchedComparison = ({ artifactRoot, comparisonId, currentHead, currentRunnerSourceSha256 }) => {
    if (!safeId(comparisonId)) throw fail('INVALID_COMPARISON_ID');
    const filename = path.resolve(artifactRoot, 'comparisons', `${comparisonId}.json`);
    if (!inside(path.join(artifactRoot, 'comparisons'), filename) || !fs.existsSync(filename)) throw fail('COMPARISON_NOT_FOUND');
    const bytes = fs.readFileSync(filename);
    const comparison = JSON.parse(bytes.toString('utf8'));
    if (comparison.comparisonId !== comparisonId || comparison.mode !== 'real-gemini'
        || comparison.dataset !== 'heldout' || comparison.comparisonValid !== true
        || comparison.sameDenominator !== true || comparison.candidateCommit !== currentHead) {
        throw fail('MATCHED_REAL_HELDOUT_COMPARISON_REQUIRED');
    }
    const byEngine = Object.fromEntries((comparison.results || []).map(result => [result.engine, result]));
    const baseline = readMatchedRun(byEngine['baseline-v1-2'], artifactRoot);
    const candidate = readMatchedRun(byEngine['candidate-v1-3'], artifactRoot);
    for (const { run } of [baseline, candidate]) {
        if (run.runnerSourceSha256 !== currentRunnerSourceSha256 || run.dataset.sha256 !== comparison.datasetSha256
            || run.benchmarkOracle.oracleSha256 !== comparison.oracleSha256) throw fail('STALE_RUNNER_ORACLE_OR_DATASET');
    }
    if (candidate.run.sourceRevision !== currentHead || candidate.run.engineSourceSha256 !== byEngine['candidate-v1-3'].engineSourceSha256) {
        throw fail('CANDIDATE_RUN_REVISION_MISMATCH');
    }
    if (baseline.run.sourceRevision !== comparison.baselineCommit || baseline.run.engineSourceSha256 !== byEngine['baseline-v1-2'].engineSourceSha256) {
        throw fail('BASELINE_RUN_REVISION_MISMATCH');
    }
    return { comparison, comparisonSha256: sha256(bytes), baseline, candidate };
};

const inputBoundFor = judgeInput => Buffer.byteLength(judgeInput.systemPrompt, 'utf8')
    + judgeInput.messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);

const reservationFor = (inputBound, pricing, outputTokens = MAX_OUTPUT_TOKENS) => Math.ceil(
    inputBound * pricing.inputUsdPerMillion * 1000 + outputTokens * pricing.outputUsdPerMillion * 1000,
) / 1_000_000_000;

const resultPathFromEnv = () => {
    const requested = path.resolve(process.env.LAB_SEMANTIC_RESULT_PATH || '');
    const reportsRoot = path.join(ARTIFACT_ROOT, 'reports');
    if (!inside(reportsRoot, requested) || !/^customer-usefulness-[a-f0-9-]{36}\.json$/.test(path.basename(requested))) {
        throw fail('SEMANTIC_RESULT_PATH_INVALID');
    }
    return requested;
};

const writeNewJson = (filename, value) => {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
};

const engineScores = (item, judge) => {
    const candidateLabel = Object.keys(item.presentation.armToEngine)
        .find(label => item.presentation.armToEngine[label] === 'candidate');
    const baselineLabel = candidateLabel === 'A' ? 'B' : 'A';
    return {
        baseline: judge[baselineLabel],
        candidate: judge[candidateLabel],
        preference: judge.preference === candidateLabel ? 'candidate'
            : judge.preference === baselineLabel ? 'baseline' : 'tie',
        rationale: judge.rationale,
    };
};

const summaryRows = (cases, results) => {
    const byId = new Map(results.map(result => [result.caseId, result]));
    return cases.flatMap(item => {
        const result = byId.get(item.caseId);
        if (!result) return [];
        const preference = result.scores.preference === 'tie' ? 'TIE'
            : result.scores.preference === item.presentation.armToEngine.A ? 'A' : 'B';
        return [{ caseId: item.caseId, judge: {
            A: item.presentation.armToEngine.A === 'candidate' ? result.scores.candidate : result.scores.baseline,
            B: item.presentation.armToEngine.B === 'candidate' ? result.scores.candidate : result.scores.baseline,
            preference,
            rationale: result.scores.rationale,
        } }];
    });
};

const runJudgeStage = async ({ cases, inputs, budget, llm, model, operationPrefix, stage }) => {
    const client = createGeminiEvaluationClient({ budget, llm, model, operationPrefix });
    const results = [];
    let failureCode = null;
    for (let index = 0; index < cases.length; index += 1) {
        const item = cases[index];
        const judgeInput = inputs[index];
        const inputBound = inputBoundFor(judgeInput);
        try {
            const response = await client.chat({
                ...judgeInput,
                maxTokens: MAX_OUTPUT_TOKENS,
                operationId: `${stage}-${String(index + 1).padStart(3, '0')}`,
            });
            const judge = parseJudgeResponse(response.text);
            const receipt = response.budget || {};
            results.push({
                caseId: item.caseId,
                language: item.language,
                sharedAnswerability: item.sharedAnswerability,
                scores: engineScores(item, judge),
                judge: { provider: model === PRIMARY_MODEL ? 'gemini-lite' : 'gemini-pro', model },
                request: {
                    requestId: receipt.requestId || null,
                    latencyMs: receipt.latencyMs ?? response.latencyMs ?? null,
                    inputTokenUpperBound: inputBound,
                    maxOutputTokens: MAX_OUTPUT_TOKENS,
                    inputTokens: receipt.inputTokens ?? null,
                    outputTokens: receipt.outputTokens ?? null,
                    thinkingTokens: receipt.thinkingTokens ?? null,
                    estimatedProviderChargeUsd: receipt.estimatedProviderChargeUsd ?? null,
                    status: receipt.status || 'UNKNOWN',
                },
            });
        } catch (error) {
            failureCode = /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'JUDGE_EVALUATION_FAILED';
            break;
        }
    }
    return { results, failureCode };
};

const withTemporaryEnvironment = async (values, callback) => {
    const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    try {
        for (const [key, value] of Object.entries(values)) process.env[key] = value;
        return await callback();
    } finally {
        for (const [key, value] of Object.entries(prior)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
};

const main = async () => {
    if (process.env.NODE_ENV !== 'test' || process.env.EASYMOD_LIVE_GEMINI_EGRESS !== '1') throw fail('PAID_EVALUATION_EGRESS_NOT_EXPLICIT');
    if (typeof process.env['EM-GEMINI-KEY'] !== 'string' || !process.env['EM-GEMINI-KEY'].trim()) throw fail('EM_GEMINI_KEY_UNAVAILABLE');
    const campaignId = process.env.LAB_CAMPAIGN_ID;
    if (!safeId(campaignId) || !campaignId.startsWith('v13-semantic-')) throw fail('FRESH_SEMANTIC_CAMPAIGN_REQUIRED');
    const resultPath = resultPathFromEnv();
    const ledgerPath = path.join(ARTIFACT_ROOT, 'campaigns', campaignId, 'budget-ledger.json');
    if (fs.existsSync(resultPath) || fs.existsSync(path.dirname(ledgerPath))) throw fail('SEMANTIC_OUTPUT_OR_CAMPAIGN_ALREADY_EXISTS');

    const head = git('rev-parse', 'HEAD');
    if (git('status', '--porcelain')) throw fail('CLEAN_COMMITTED_CANDIDATE_REQUIRED');
    const provenance = getSourceProvenance();
    const matched = loadMatchedComparison({
        artifactRoot: ARTIFACT_ROOT,
        comparisonId: process.env.LAB_SEMANTIC_COMPARISON_ID,
        currentHead: head,
        currentRunnerSourceSha256: provenance.runnerSourceSha256,
    });
    const cases = buildUsefulnessCases({
        baselineRun: matched.baseline.run,
        candidateRun: matched.candidate.run,
        comparisonId: matched.comparison.comparisonId,
    });
    if (cases.length !== REQUIRED_CASE_COUNT) throw fail('HELDOUT_COVERAGE_REQUIRED');

    const primaryInputs = cases.map(item => buildBlindedJudgeInput(item));
    const consistencyCases = selectJudgeConsistencyCases(cases);
    const consistencyInputs = consistencyCases.map(item => buildBlindedJudgeInput(item, { crosscheck: true }));
    const primaryBounds = primaryInputs.map(inputBoundFor);
    const consistencyBounds = consistencyInputs.map(inputBoundFor);
    if ([...primaryBounds, ...consistencyBounds].some(bound => bound > MAX_INPUT_TOKENS)) throw fail('JUDGE_PROMPT_EXCEEDS_INPUT_BOUND');
    const primaryWorstCase = primaryBounds.reduce((sum, bound) => sum + reservationFor(bound, GEMINI_PRICE_SNAPSHOT), 0);
    const consistencyWorstCase = consistencyBounds.reduce((sum, bound) => sum + reservationFor(bound, GEMINI_PRO_PRICE_SNAPSHOT), 0);
    const worstCaseReservationUsd = Number((primaryWorstCase + consistencyWorstCase).toFixed(9));
    if (worstCaseReservationUsd > CEILING_USD) throw fail('SEMANTIC_CAMPAIGN_RESERVATION_EXCEEDS_CEILING');

    const campaignLedger = createEvaluationCampaignLedger({
        ledgerPath,
        campaignId,
        ceilingUsd: CEILING_USD,
        maxRequests: MAX_REQUESTS,
        maxVisionRequests: 0,
    });
    if (campaignLedger.snapshot().requestCount !== 0) throw fail('FRESH_SEMANTIC_CAMPAIGN_REQUIRED');
    const primaryBudget = createEvaluationBudget({
        model: PRIMARY_MODEL,
        ceilingUsd: CEILING_USD,
        maxRequests: REQUIRED_CASE_COUNT,
        maxVisionRequests: 0,
        maxConcurrency: 1,
        maxInputTokens: MAX_INPUT_TOKENS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        maxTimeoutMs: 30000,
    }, { onSnapshot: snapshot => campaignLedger.record(PRIMARY_STAGE, snapshot) });
    const consistencyBudget = createEvaluationBudget({
        model: CONSISTENCY_MODEL,
        thinkingLevel: 'low',
        ceilingUsd: CEILING_USD,
        maxRequests: consistencyCases.length,
        maxVisionRequests: 0,
        maxConcurrency: 1,
        maxInputTokens: MAX_INPUT_TOKENS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        maxTimeoutMs: 30000,
    }, { onSnapshot: snapshot => campaignLedger.record(CONSISTENCY_STAGE, snapshot) });

    const startedAt = new Date().toISOString();
    const llm = await withTemporaryEnvironment({
        LLM_GEMINI_LITE_MODEL: PRIMARY_MODEL,
        LLM_GEMINI_PRO_MODEL: CONSISTENCY_MODEL,
        LLM_TEMPERATURE: '0',
        AI_USAGE_ACCOUNTING: 'false',
    }, async () => {
        const service = require('../../src/modules/ai/llm.service');
        const primary = await runJudgeStage({
            cases, inputs: primaryInputs, budget: primaryBudget, llm: service,
            model: PRIMARY_MODEL, operationPrefix: 'useful-lite-v2', stage: PRIMARY_STAGE,
        });
        const consistency = primary.failureCode ? { results: [], failureCode: 'SKIPPED_PRIMARY_INCOMPLETE' }
            : await runJudgeStage({
                cases: consistencyCases, inputs: consistencyInputs, budget: consistencyBudget, llm: service,
                model: CONSISTENCY_MODEL, operationPrefix: 'useful-pro-v2', stage: CONSISTENCY_STAGE,
            });
        return { primary, consistency };
    });

    const summary = summarizeUsefulnessResults(cases, summaryRows(cases, llm.primary.results));
    const consistencyRows = llm.consistency.results.map(item => ({
        caseId: item.caseId,
        baseline: item.scores.baseline,
        candidate: item.scores.candidate,
        preference: item.scores.preference,
    }));
    const judgeConsistency = summarizeJudgeConsistency(cases, summary.paired, consistencyRows);
    const ledger = campaignLedger.snapshot();
    const returnedRequestCount = llm.primary.results.length + llm.consistency.results.length;
    const allRequestsPriced = ledger.requestCount === returnedRequestCount && ledger.unpricedRequestCount === 0;
    const complete = llm.primary.results.length === REQUIRED_CASE_COUNT
        && llm.consistency.results.length === consistencyCases.length
        && !llm.primary.failureCode && !llm.consistency.failureCode
        && returnedRequestCount === MAX_REQUESTS && ledger.requestCount === MAX_REQUESTS && allRequestsPriced;
    const semanticStatus = !complete || summary.status === 'INCOMPLETE' || judgeConsistency.status === 'INCOMPLETE'
        ? 'INCOMPLETE' : summary.status === 'PASS' && judgeConsistency.status === 'PASS' ? 'PASS' : 'FAIL';
    const finishedAt = new Date().toISOString();
    const artifact = {
        schemaVersion: 1,
        kind: 'paired-blinded-customer-usefulness-evaluation',
        evaluationId: path.basename(resultPath, '.json').slice('customer-usefulness-'.length),
        status: semanticStatus,
        startedAt,
        completedAt: finishedAt,
        failureCode: llm.primary.failureCode || llm.consistency.failureCode,
        comparison: {
            comparisonId: matched.comparison.comparisonId,
            comparisonSha256: matched.comparisonSha256,
            datasetSha256: matched.comparison.datasetSha256,
            oracleSha256: matched.comparison.oracleSha256,
            baselineRunId: matched.baseline.run.runId,
            baselineRunSha256: matched.baseline.sha256,
            candidateRunId: matched.candidate.run.runId,
            candidateRunSha256: matched.candidate.sha256,
            candidateCommit: head,
        },
        provenance: {
            model: PRIMARY_MODEL,
            provider: 'gemini-lite',
            rubricVersion: USEFULNESS_RUBRIC_VERSION,
            promptSha256: sha256(SYSTEM_PROMPT),
            runnerSourceSha256: provenance.runnerSourceSha256,
            runnerRevision: provenance.runnerRevision,
            thinkingLevel: null,
            temperature: 0,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            maxInputTokens: MAX_INPUT_TOKENS,
            expectedCases: REQUIRED_CASE_COUNT,
            expectedRequests: REQUIRED_CASE_COUNT,
            actualRequests: llm.primary.results.length,
            maximumSingleInputBound: primaryBounds.length ? Math.max(...primaryBounds) : 0,
            worstCaseReservationUsd: Number(primaryWorstCase.toFixed(9)),
            consistencyJudge: {
                provider: 'gemini-pro',
                model: CONSISTENCY_MODEL,
                promptSha256: sha256(CROSSCHECK_SYSTEM_PROMPT),
                thinkingLevel: 'low',
                temperature: 0,
                expectedCases: consistencyCases.length,
                expectedRequests: consistencyCases.length,
                actualRequests: llm.consistency.results.length,
                maximumSingleInputBound: consistencyBounds.length ? Math.max(...consistencyBounds) : 0,
                worstCaseReservationUsd: Number(consistencyWorstCase.toFixed(9)),
                selectedCasesSha256: sha256(consistencyCases.map(item => item.caseId).join('\n')),
                casesPerLanguageAnswerabilityStratum: 5,
            },
        },
        budget: {
            campaignId,
            campaignLedgerPath: path.relative(ARTIFACT_ROOT, ledgerPath).replace(/\\/g, '/'),
            ceilingUsd: ledger.ceilingUsd,
            requestCount: ledger.requestCount,
            expectedRequests: MAX_REQUESTS,
            visionRequestCount: ledger.visionRequestCount,
            reservedWorstCaseUsd: ledger.reservedWorstCaseUsd,
            estimatedProviderChargeUsd: ledger.estimatedProviderChargeUsd,
            unpricedRequestCount: ledger.unpricedRequestCount,
            providerInvoice: ledger.providerInvoice,
            pricing: {
                primary: primaryBudget.snapshot().pricing,
                consistency: consistencyBudget.snapshot().pricing,
            },
        },
        summary: {
            ...summary,
            status: semanticStatus,
            usefulnessStatus: summary.status,
            judgeConsistency,
            complete,
            allRequestsPriced,
        },
        results: llm.primary.results,
        consistencyResults: llm.consistency.results,
    };
    writeNewJson(resultPath, artifact);
    process.stdout.write(`${JSON.stringify({
        status: artifact.status,
        usefulnessStatus: summary.status,
        judgeConsistencyStatus: judgeConsistency.status,
        evaluationId: artifact.evaluationId,
        primaryCases: llm.primary.results.length,
        consistencyCases: llm.consistency.results.length,
        campaignId,
        estimatedProviderChargeUsd: ledger.estimatedProviderChargeUsd,
        reservedWorstCaseUsd: ledger.reservedWorstCaseUsd,
        candidateOverallUsefulness: summary.candidate.overallUsefulness,
        baselineOverallUsefulness: summary.baseline.overallUsefulness,
        candidateMinusBaselineOverallMean: summary.candidateMinusBaselineOverallMean,
        resultPath,
    })}\n`);
    if (artifact.status !== 'PASS') process.exitCode = 2;
};

if (require.main === module) {
    main().catch(error => {
        const code = /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'SEMANTIC_EVALUATION_FAILED';
        process.stderr.write(`Semantic customer-usefulness evaluation stopped: ${code}.\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    CEILING_USD,
    MAX_REQUESTS,
    MAX_INPUT_TOKENS,
    MAX_OUTPUT_TOKENS,
    inputBoundFor,
    reservationFor,
    loadMatchedComparison,
};
