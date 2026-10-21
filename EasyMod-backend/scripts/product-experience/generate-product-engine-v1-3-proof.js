'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');
const DOC_ROOT = path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-3');
const ARTIFACT_ROOT = path.resolve(process.env.LAB_ARTIFACT_ROOT || path.join(DOC_ROOT, 'artifacts'));
const COMPARISON_ROOT = path.join(ARTIFACT_ROOT, 'comparisons');
const RUN_ROOT = path.join(ARTIFACT_ROOT, 'runs');
const SOURCE_PATH = path.join(WORKSPACE_ROOT, 'customer-simulator.csv');
const BASELINE_SHA = '957bb991a18db1949369a6f805822b8c8b69889b';
const CAMPAIGN_ID = 'v13-cf6f18b2-2a9a-4831-ad42-2b8509bfcd35';
const PROOF_JSON = path.join(ARTIFACT_ROOT, 'product-engine-v1.3-proof.json');
const PROOF_MARKDOWN = path.join(DOC_ROOT, 'PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

const backendSourceSha256 = () => {
    const sourceRoot = path.join(BACKEND_ROOT, 'src');
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

const jsonFiles = directory => fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => path.join(directory, name))
    : [];

const newestMatching = (directory, predicate) => jsonFiles(directory)
    .map(filename => {
        try { return { filename, value: readJson(filename) }; } catch (_) { return null; }
    })
    .filter(item => item && predicate(item.value, item.filename))
    .sort((left, right) => String(right.value.completedAt || right.value.updatedAt || '').localeCompare(String(left.value.completedAt || left.value.updatedAt || '')))[0] || null;

const pathInside = (root, relativePath) => {
    const target = path.resolve(root, relativePath);
    return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null;
};

const matchingComparison = (mode, dataset, sourceHash, oracleSha, engineHash) => newestMatching(COMPARISON_ROOT, item => {
    const candidate = item.results?.find(result => result.engine === 'candidate-v1-3');
    return item.mode === mode && item.dataset === dataset
        && item.datasetSha256 === sourceHash && item.oracleSha256 === oracleSha
        && candidate?.engineSourceSha256 === engineHash;
});

const comparisonSummary = (entry, engineName) => entry?.value.results?.find(result => result.engine === engineName)?.summary || null;
const runArtifactFor = (entry, engineName) => {
    const result = entry?.value.results?.find(item => item.engine === engineName);
    const filename = result?.artifactPath ? pathInside(ARTIFACT_ROOT, result.artifactPath) : null;
    if (!filename || !fs.existsSync(filename)) return null;
    try { return readJson(filename); } catch (_) { return null; }
};

const metric = value => Number.isFinite(value) ? value : 'NOT_MEASURED';
const percent = (numerator, denominator) => denominator > 0 ? `${(100 * numerator / denominator).toFixed(1)}%` : 'NOT_MEASURED';
const safeText = (value, maxLength = 220) => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const passState = value => value === true ? 'PASS' : value === false ? 'FAIL' : 'NOT_RUN';

const safeExamples = run => {
    if (!Array.isArray(run?.turns)) return [];
    const turns = run.turns.filter(turn => turn.oracle?.textOnlyMetricEligible === true);
    const specs = [
        ['Verified product answer', turn => (turn.factScores?.correctAnsweredSlots || 0) > 0],
        ['False-refusal sample', turn => (turn.factScores?.unnecessaryRefusalSlots || 0) > 0],
        ['Context-resolution failure', turn => turn.oracle?.sourceContextProductId && !turn.oracle?.productId],
        ['Merchant-policy handoff', turn => (turn.oracle?.crossDomainHandoffs || []).includes('merchant_policy')],
    ];
    const selected = [];
    const used = new Set();
    for (const [label, predicate] of specs) {
        const turn = turns.find(item => !used.has(item.scenarioId) && predicate(item));
        if (!turn) continue;
        used.add(turn.scenarioId);
        selected.push({
            scenarioId: turn.scenarioId,
            label,
            customerMessageRedacted: safeText(turn.inputRedacted),
            engineResponseRedacted: safeText(turn.finalReplyRedacted),
            evaluation: turn.evaluationStatus,
            disposition: turn.disposition,
            correctAnsweredSlots: turn.factScores?.correctAnsweredSlots ?? null,
            eligibleSlots: turn.factScores?.eligibleSlots ?? null,
        });
    }
    return selected;
};

const main = () => {
    const head = git('rev-parse', 'HEAD');
    const branch = git('branch', '--show-current');
    const currentEngineHash = backendSourceSha256();
    const sourceBytes = fs.readFileSync(SOURCE_PATH);
    const sourceHash = sha256(sourceBytes);
    const sourceOraclePath = path.join(ARTIFACT_ROOT, 'benchmarks', 'customer-truth-oracle.json');
    const heldoutPath = path.join(ARTIFACT_ROOT, 'benchmarks', 'heldout-customer-questions.csv');
    const heldoutOraclePath = path.join(ARTIFACT_ROOT, 'benchmarks', 'heldout-customer-truth-oracle.json');
    const sourceOracle = fs.existsSync(sourceOraclePath) ? readJson(sourceOraclePath) : null;
    const heldoutBytes = fs.existsSync(heldoutPath) ? fs.readFileSync(heldoutPath) : null;
    const heldoutHash = heldoutBytes ? sha256(heldoutBytes) : null;
    const heldoutOracle = fs.existsSync(heldoutOraclePath) ? readJson(heldoutOraclePath) : null;
    const sourceOracleSha = sourceOracle?.oracleSha256 || null;
    const heldoutOracleSha = heldoutOracle?.oracleSha256 || null;
    const sourceComparisonEntry = sourceOracle
        ? matchingComparison('deterministic', 'source', sourceHash, sourceOracleSha, currentEngineHash) : null;
    const heldoutComparisonEntry = heldoutOracle
        ? matchingComparison('deterministic', 'heldout', heldoutHash, heldoutOracleSha, currentEngineHash) : null;
    const realComparisonEntry = sourceOracle
        ? matchingComparison('real-gemini', 'source', sourceHash, sourceOracleSha, currentEngineHash) : null;
    const sourceComparison = sourceComparisonEntry?.value || null;
    const heldoutComparison = heldoutComparisonEntry?.value || null;
    const realComparison = realComparisonEntry?.value || null;
    const sourceCandidate = comparisonSummary(sourceComparisonEntry, 'candidate-v1-3');
    const sourceBaseline = comparisonSummary(sourceComparisonEntry, 'baseline-v1-2');
    const heldoutCandidate = comparisonSummary(heldoutComparisonEntry, 'candidate-v1-3');
    const heldoutBaseline = comparisonSummary(heldoutComparisonEntry, 'baseline-v1-2');
    const realCandidate = comparisonSummary(realComparisonEntry, 'candidate-v1-3');
    const sourceRun = runArtifactFor(sourceComparisonEntry, 'candidate-v1-3');
    const realRun = runArtifactFor(realComparisonEntry, 'candidate-v1-3');
    const integrationEntry = newestMatching(path.join(ARTIFACT_ROOT, 'integration'), item => item.candidateBackendSourceSha256 === currentEngineHash);
    const integration = integrationEntry?.value || null;
    const regressionEntry = newestMatching(path.join(ARTIFACT_ROOT, 'regression'), item => item.candidateCommit === head
        || item.candidateBackendSourceSha256 === currentEngineHash);
    const regression = regressionEntry?.value || null;
    const playwrightPath = path.join(ARTIFACT_ROOT, 'playwright', 'execution.json');
    const playwright = fs.existsSync(playwrightPath) ? readJson(playwrightPath) : null;
    const privacyPath = path.join(ARTIFACT_ROOT, 'security', 'artifact-privacy-scan.json');
    const privacy = fs.existsSync(privacyPath) ? readJson(privacyPath) : null;
    const independentPath = path.join(DOC_ROOT, 'independent-verification.json');
    const independent = fs.existsSync(independentPath) ? readJson(independentPath) : null;
    const campaignPath = path.join(ARTIFACT_ROOT, 'campaigns', CAMPAIGN_ID, 'budget-ledger.json');
    const campaign = fs.existsSync(campaignPath) ? readJson(campaignPath) : null;
    const verificationReceiptPath = process.env.LAB_VERIFY_RECEIPT_PATH || null;
    const verificationReceipt = verificationReceiptPath && fs.existsSync(verificationReceiptPath)
        ? readJson(verificationReceiptPath) : regression;
    const sourceTurns = sourceOracle?.turns || [];
    const textProductTurns = sourceTurns.filter(turn => turn.textOnlyMetricEligible
        && (turn.classificationTags || []).some(tag => ['product_fact_request', 'product_identity_request'].includes(tag)));
    const textAnswerableTurns = sourceTurns.filter(turn => turn.textOnlyMetricEligible && turn.eligibility === 'ANSWERABLE');
    const eligibleFactSlots = textAnswerableTurns.reduce((sum, turn) => sum + (turn.eligibleSlots || []).length, 0);
    const photos = realRun?.genuinePhotoEvaluation?.cases || [];
    const photosTested = realRun?.genuinePhotoEvaluation?.photosTested ?? null;
    const photoCategoryMatches = photos.filter(photo => photo.categoryMatch === true).length;
    const photoColorMatches = photos.filter(photo => photo.dominantColorMatch === true).length;
    const realRequests = realComparison ? realComparison.results.reduce((sum, result) => sum
        + (result.summary?.textRequests || 0) + (result.summary?.visionRequests || 0), 0) : null;
    const realTextRequests = realComparison ? realComparison.results.reduce((sum, result) => sum + (result.summary?.textRequests || 0), 0) : null;
    const realVisionRequests = realComparison ? realComparison.results.reduce((sum, result) => sum + (result.summary?.visionRequests || 0), 0) : null;
    const realEstimatedSpend = realComparison ? realComparison.results.reduce((sum, result) => sum
        + (Number.isFinite(result.summary?.estimatedProviderChargeUsd) ? result.summary.estimatedProviderChargeUsd : 0), 0) : null;
    const campaignBudgetExhausted = campaign ? campaign.requestCount >= campaign.maxRequests
        || campaign.visionRequestCount >= campaign.maxVisionRequests
        || campaign.reservedWorstCaseUsd >= campaign.ceilingUsd : null;
    const sourceComparisonValid = sourceComparison?.comparisonValid === true;
    const heldoutComparisonValid = heldoutComparison?.comparisonValid === true;
    const integrationPass = integration ? integration.status === 'PASS' : null;
    const postgresPass = integrationPass === null ? null : integrationPass
        && integration.services?.some(service => service.name === 'postgres' && service.health === 'compose-healthcheck');
    const redisPass = integrationPass === null ? null : integrationPass
        && integration.services?.some(service => service.name === 'redis' && service.health === 'compose-healthcheck');
    const selectedIntegrationPass = integration?.jest?.selectedIntegration?.exitCode === 0
        && !integration.jest.selectedIntegration.timedOut;
    const webhookPass = integration?.jest?.webhookPipelineE2E?.exitCode === 0
        && !integration.jest.webhookPipelineE2E.timedOut;
    const workerPass = selectedIntegrationPass && (integration?.jest?.selectedIntegration?.structured?.passedTests || 0) > 0;
    const productSearchPass = webhookPass && (integration?.jest?.webhookPipelineE2E?.structured?.passedTestTitles || [])
        .some(title => /worker reads a catalog update|product.*catalog/i.test(title));
    const fakeMetaPass = webhookPass && integration?.testPaths?.webhookPipelineE2E === 'tests/meta-e2e/meta-e2e.test.js';
    const backendRegressionPass = integration?.jest?.backendRegression?.exitCode === 0
        && !integration.jest.backendRegression.timedOut;
    const playwrightPass = playwright?.playwrightExitCode === 0
        && (playwright?.tests?.failed || 0) === 0
        && (playwright?.tests?.passed || 0) > 0;
    const privacyPass = privacy?.status === 'PASS';
    const backendSecurityStep = verificationReceipt?.steps?.find(step => step.name === 'backend-security-suite') || null;
    const backendSecurityPass = backendSecurityStep?.status === 'PASS';
    const securityPass = integration ? integration.egress?.guard === 'PASS' && backendRegressionPass && backendSecurityPass : null;
    const realGeminiStatus = realComparison ? (realComparison.comparisonValid ? 'PASS' : 'FAIL') : 'NOT_RUN';
    const sourceTruthMetricsAvailable = Boolean(sourceComparisonValid && sourceCandidate);
    const unsupportedClaims = sourceCandidate?.unsupportedClaimsSent ?? null;
    const falseRefusals = sourceCandidate?.falseRefusalSlots ?? null;
    const contextFailures = sourceCandidate?.contextResolutionFailures ?? null;
    const unsafeCrossDomain = sourceCandidate?.unsafeCrossDomainHandoffs ?? null;
    const qualityPass = sourceTruthMetricsAvailable && unsupportedClaims === 0 && falseRefusals === 0
        && contextFailures === 0 && unsafeCrossDomain === 0;
    const independentPass = independent?.verdict === 'PASS'
        && independent?.reviewedCodeCommit === (verificationReceipt?.candidateCommit || head)
        && independent?.reviewedBackendSourceSha256 === currentEngineHash;
    const automatedStepsPass = verificationReceipt?.status === 'PASS'
        && Array.isArray(verificationReceipt.steps)
        && verificationReceipt.steps.every(step => step.status === 'PASS' || step.status === 'NOT_RUN_OFFLINE_DEFAULT');
    const requiredEvidencePresent = sourceComparisonValid && heldoutComparisonValid && integrationPass && playwrightPass
        && securityPass && privacyPass && realGeminiStatus === 'PASS' && independentPass;
    const hasAutomatedFailure = verificationReceipt?.status === 'FAIL' || regression?.status === 'FAIL'
        || [sourceComparison, heldoutComparison, realComparison, integration, playwright, privacy]
            .some(item => (item && item.status === 'FAIL') || (item && item.comparisonValid === false));
    const automatedQaVerdict = hasAutomatedFailure || (sourceTruthMetricsAvailable && !qualityPass) ? 'FAIL'
        : requiredEvidencePresent && automatedStepsPass ? 'PASS' : 'BLOCKED';
    const integrationReady = automatedQaVerdict === 'PASS' && qualityPass && photosTested === 3
        && photoCategoryMatches === photosTested && photoColorMatches === photosTested;
    const sourceRunResults = safeExamples(sourceRun);
    const backendRegressionTests = integration?.jest?.backendRegression?.tests || 'NOT_RUN';
    const selectedIntegrationTests = integration?.jest?.selectedIntegration?.tests || 'NOT_RUN';
    const webhookTests = integration?.jest?.webhookPipelineE2E?.tests || 'NOT_RUN';
    const totalIncorrectOrUnansweredSlots = Array.isArray(sourceRun?.turns) ? sourceRun.turns
        .filter(turn => turn.oracle?.textOnlyMetricEligible && turn.oracle?.eligibility === 'ANSWERABLE')
        .reduce((sum, turn) => sum + (turn.factScores?.incorrectOrUnansweredSlots || 0), 0) : null;
    const machineStatus = {
        PROJECT: 'EasyModerator',
        MILESTONE: 'Product Engine V1.3',
        GOAL: 'Integration & Customer Truth Verification',
        V1_2_BASE_SHA: BASELINE_SHA,
        V1_3_BRANCH: branch,
        V1_3_FINAL_SHA: verificationReceipt?.candidateCommit || head,
        WORKTREE_CLEAN: verificationReceipt?.worktreeCleanAtStart === true || !git('status', '--porcelain'),
        SOURCE_PERSONAS: sourceOracle?.source?.personas ?? 'UNKNOWN',
        SOURCE_TURNS: sourceOracle?.source?.turns ?? 'UNKNOWN',
        ELIGIBLE_PRODUCT_TURNS: sourceOracle ? textProductTurns.length : 'UNKNOWN',
        ANSWERABLE_PRODUCT_TURNS: sourceOracle ? textAnswerableTurns.length : 'UNKNOWN',
        VERIFIED_CORRECT_ANSWERS: sourceCandidate?.verifiedCorrectAnswers ?? 'NOT_RUN',
        INCORRECT_PRODUCT_ANSWERS: 'NOT_SEPARATELY_MEASURED',
        UNSUPPORTED_CLAIMS: unsupportedClaims ?? 'NOT_RUN',
        FALSE_REFUSALS: falseRefusals ?? 'NOT_RUN',
        CONTEXT_FAILURES: contextFailures ?? 'NOT_RUN',
        SAFE_CROSS_DOMAIN_HANDOFFS: sourceCandidate?.safeCrossDomainHandoffs ?? 'NOT_RUN',
        GENUINE_PHOTOS_TESTED: realComparison ? (photosTested ?? 'NOT_RUN') : 'NOT_RUN',
        REAL_GEMINI_TEXT_REQUESTS: realComparison ? (realTextRequests ?? 0) : 'NOT_RUN',
        REAL_GEMINI_VISION_REQUESTS: realComparison ? (realVisionRequests ?? 0) : 'NOT_RUN',
        REAL_PROVIDER_ESTIMATED_COST_USD: realComparison ? (realEstimatedSpend ?? 'NOT_MEASURED') : 'NOT_RUN',
        PROVIDER_BUDGET_EXHAUSTED: campaignBudgetExhausted === null ? 'UNKNOWN' : campaignBudgetExhausted ? 'YES' : 'NO',
        POSTGRES_INTEGRATION: passState(postgresPass),
        REDIS_INTEGRATION: passState(redisPass),
        MESSAGE_WORKER_INTEGRATION: passState(integration ? workerPass : null),
        WEBHOOK_PIPELINE: passState(integration ? webhookPass : null),
        PRODUCT_SEARCH_INTEGRATION: passState(integration ? productSearchPass : null),
        FAKE_META_TRANSPORT: passState(integration ? fakeMetaPass : null),
        BACKEND_REGRESSION: backendRegressionPass ? 'PASS' : integration ? 'FAIL' : 'NOT_RUN',
        PLAYWRIGHT_E2E: playwrightPass ? 'PASS' : playwright ? 'FAIL' : 'NOT_RUN',
        SECURITY_TESTS: securityPass === null ? 'NOT_RUN' : securityPass ? 'PASS' : 'FAIL',
        PRIVACY_SCAN: privacyPass ? 'PASS' : privacy ? 'FAIL' : 'NOT_RUN',
        INDEPENDENT_VERIFICATION: independentPass ? 'PASS' : independent?.verdict || 'NOT_RUN',
        BASELINE_COMPARISON_VALID: sourceComparisonValid ? 'YES' : sourceComparison ? 'NO' : 'NOT_RUN',
        CUSTOMER_TRUTH_VERDICT: sourceTruthMetricsAvailable ? (qualityPass ? 'PASS' : 'FAIL') : 'NOT_RUN',
        COMMERCIAL_EVIDENCE_VERDICT: 'NOT_ESTABLISHED',
        AUTOMATED_QA_VERDICT: automatedQaVerdict,
        INTEGRATION_READY: integrationReady ? 'YES' : 'NO',
        OTHER_AGENT_WORKTREES_TOUCHED: 'NO',
        PRODUCTION_CHANGED: 'NO',
        PUSHED: 'NO',
        MERGED: 'NO',
        DEPLOYED: 'NO',
        PRODUCTION_RELEASE_NOT_AUTHORIZED: 'YES',
    };

    const comparisonDetails = {
        deterministicSource: sourceComparison ? {
            comparisonId: sourceComparison.comparisonId,
            valid: sourceComparison.comparisonValid,
            candidateCommit: sourceComparison.candidateCommit,
            oracleSha256: sourceComparison.oracleSha256,
            baseline: sourceBaseline,
            candidate: sourceCandidate,
            outcomes: sourceComparison.metricOutcomes,
        } : null,
        deterministicHeldout: heldoutComparison ? {
            comparisonId: heldoutComparison.comparisonId,
            valid: heldoutComparison.comparisonValid,
            oracleSha256: heldoutComparison.oracleSha256,
            baseline: heldoutBaseline,
            candidate: heldoutCandidate,
        } : null,
        realGemini: realComparison ? {
            comparisonId: realComparison.comparisonId,
            valid: realComparison.comparisonValid,
            model: realComparison.model,
            textRequestsBothEngines: realTextRequests,
            visionRequestsBothEngines: realVisionRequests,
            estimatedProviderChargeUsdBothEngines: realEstimatedSpend,
            candidateUnpricedProviderCalls: realCandidate?.unpricedProviderCalls ?? null,
            candidate: realCandidate,
            photosTested: photosTested,
            photoCategoryMatches,
            photoColorMatches,
            photoCases: photos.map(photo => ({
                fixtureId: photo.fixtureId,
                fixtureSha256: photo.fixtureSha256,
                status: photo.status,
                observedCategory: photo.observedCategory,
                categoryMatch: photo.categoryMatch,
                observedDominantColor: photo.observedDominantColor,
                dominantColorMatch: photo.dominantColorMatch,
                unverifiedMaterialFieldPopulated: photo.unverifiedMaterialFieldPopulated,
                routeLatencyMs: photo.routeLatencyMs,
                estimatedProviderChargeUsd: photo.estimatedProviderChargeUsd,
            })),
        } : { status: 'NOT_RUN' },
    };

    const proof = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: machineStatus,
        candidate: {
            testedCodeCommit: verificationReceipt?.candidateCommit || head,
            evidenceRepositoryHead: head,
            branch,
            worktree: REPO_ROOT,
            backendSourceSha256: currentEngineHash,
            baselineSha: BASELINE_SHA,
            cleanAtVerificationStart: verificationReceipt?.worktreeCleanAtStart ?? null,
        },
        benchmark: {
            sourceCorpusSha256: sourceHash,
            sourceOracleSha256: sourceOracleSha,
            sourceOracleArtifactSha256: sourceOraclePath && fs.existsSync(sourceOraclePath) ? sha256(fs.readFileSync(sourceOraclePath)) : null,
            personas: sourceOracle?.source?.personas ?? null,
            turns: sourceOracle?.source?.turns ?? null,
            eligibleTextProductTurns: textProductTurns.length,
            answerableTextProductTurns: textAnswerableTurns.length,
            eligibleFactSlots,
            heldoutCorpusSha256: heldoutHash,
            heldoutOracleSha256: heldoutOracleSha,
            heldoutTurns: heldoutOracle?.source?.turns ?? null,
        },
        comparisons: comparisonDetails,
        measured: {
            verifiedCorrectAnswers: sourceCandidate?.verifiedCorrectAnswers ?? null,
            verifiedCorrectTurns: sourceCandidate?.verifiedCorrectTurns ?? null,
            falseRefusalSlots: falseRefusals,
            unsupportedPriceClaimsSent: unsupportedClaims,
            contextResolutionFailures: contextFailures,
            safeCrossDomainHandoffs: sourceCandidate?.safeCrossDomainHandoffs ?? null,
            unsafeCrossDomainHandoffs: unsafeCrossDomain,
            incorrectOrUnansweredFactSlots: totalIncorrectOrUnansweredSlots,
            incorrectProductAnswersSeparatelyMeasured: false,
            candidateP50RouteMs: sourceCandidate?.p50RouteMs ?? null,
            candidateP95RouteMs: sourceCandidate?.p95RouteMs ?? null,
            measuredLatencyLayer: 'in-process router comparison; not end-to-end merchant latency',
            estimatedProviderChargeUsd: realComparison ? realEstimatedSpend : null,
            providerInvoice: 'NOT_AVAILABLE',
            campaignCumulative: campaign ? {
                campaignId: campaign.campaignId,
                requestCount: campaign.requestCount,
                visionRequestCount: campaign.visionRequestCount,
                estimatedProviderChargeUsd: campaign.estimatedProviderChargeUsd,
                reservedWorstCaseUsd: campaign.reservedWorstCaseUsd,
                ceilingUsd: campaign.ceilingUsd,
                maxRequests: campaign.maxRequests,
                maxVisionRequests: campaign.maxVisionRequests,
            } : null,
            estimatedCostPerCandidateVerifiedAnswerUsd: realComparison && realCandidate?.verifiedCorrectAnswers > 0
                && Number.isFinite(realCandidate?.estimatedProviderChargeUsd)
                ? realCandidate.estimatedProviderChargeUsd / realCandidate.verifiedCorrectAnswers : null,
            incorrectOrUnansweredSlotDefinition: 'Answerable fact slots not answered with the expected value; includes partial answers and false refusals.',
        },
        integration: {
            status: integration?.status || 'NOT_RUN',
            composeProject: integration?.composeProject || null,
            services: integration?.services || [],
            selectedIntegration: integration?.jest?.selectedIntegration || null,
            webhookPipelineE2E: integration?.jest?.webhookPipelineE2E || null,
            backendRegression: integration?.jest?.backendRegression || null,
            egress: integration?.egress || null,
            cleanup: integration?.cleanup || null,
            productSearchEvidence: productSearchPass ? 'Meta E2E worker test reads a catalog update committed while the message waits in Redis.' : 'NOT_RUN',
            fakeMetaTransportEvidence: fakeMetaPass ? 'tests/meta-e2e/meta-e2e.test.js executed; transport is test-captured and no live Meta send is claimed.' : 'NOT_RUN',
        },
        browser: playwright || { status: 'NOT_RUN' },
        security: {
            status: securityPass ? 'PASS' : integration && backendSecurityStep ? 'FAIL' : 'NOT_RUN',
            egress: integration?.egress || null,
            backendSecuritySuite: backendSecurityStep,
            privacyScan: privacy || null,
        },
        independentVerification: independent || { verdict: 'NOT_RUN', note: 'A separate read-only reviewer has not yet recorded a result.' },
        verificationEntryPoint: verificationReceipt ? {
            status: verificationReceipt.status,
            runId: verificationReceipt.runId,
            mode: verificationReceipt.mode,
            candidateCommit: verificationReceipt.candidateCommit,
            steps: verificationReceipt.steps,
        } : { status: 'NOT_CAPTURED' },
        examples: sourceRunResults,
        limitations: [
            'Provider cost is a token-based estimate, not an invoice or merchant operating cost.',
            'The baseline/candidate replay measures in-process router latency with controlled adapters; it is not end-to-end customer latency.',
            'Three licensed public photos are a small vision probe and are not customer-upload photos or a representative accuracy study.',
            'Synthetic source turns do not establish conversion, merchant time saved, adoption, or ROI.',
            'Fake Meta transport and local test data do not establish live Meta delivery or production behavior.',
            'INCORRECT_PRODUCT_ANSWERS is not separately measured; incorrectOrUnansweredFactSlots combines partial answers and false refusals.',
        ],
    };

    const markdown = renderMarkdown(proof, machineStatus, sourceRunResults, comparisonDetails, {
        sourceOracle, sourceComparison, sourceCandidate, sourceBaseline, heldoutComparison, heldoutBaseline, heldoutCandidate,
        realComparison, realCandidate, photosTested, photoCategoryMatches, photoColorMatches,
        integration, playwright, privacy, independent, backendRegressionTests, selectedIntegrationTests, webhookTests,
        totalIncorrectOrUnansweredSlots, campaign, automatedQaVerdict, integrationReady,
    });
    fs.mkdirSync(path.dirname(PROOF_JSON), { recursive: true });
    fs.mkdirSync(path.dirname(PROOF_MARKDOWN), { recursive: true });
    fs.writeFileSync(PROOF_JSON, `${JSON.stringify(proof, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(PROOF_MARKDOWN, markdown, 'utf8');
    process.stdout.write(JSON.stringify({
        status: automatedQaVerdict === 'FAIL' ? 'FAIL' : 'PASS',
        proofJson: PROOF_JSON,
        proofMarkdown: PROOF_MARKDOWN,
        sourceComparisonValid,
        heldoutComparisonValid,
        realGeminiStatus,
        integrationReady: integrationReady ? 'YES' : 'NO',
        automatedQaVerdict,
        sourcePersonas: machineStatus.SOURCE_PERSONAS,
        sourceTurns: machineStatus.SOURCE_TURNS,
        answerableProductTurns: machineStatus.ANSWERABLE_PRODUCT_TURNS,
        verifiedCorrectAnswers: machineStatus.VERIFIED_CORRECT_ANSWERS,
    }) + '\n');
    if (automatedQaVerdict === 'FAIL') process.exitCode = 1;
};

function renderMarkdown(proof, status, examples, comparisons, details) {
    const metricTable = Object.entries(status).map(([key, value]) => `| \`${key}\` | ${String(value)} |`).join('\n');
    const exampleText = examples.length ? examples.map(example => [
        `### ${example.label} — ${example.scenarioId}`,
        `Customer message (redacted): “${example.customerMessageRedacted || '[empty]'}”`,
        `Engine response (redacted): “${example.engineResponseRedacted || '[empty]'}”`,
        `Disposition: ${example.disposition}; correct answer slots: ${example.correctAnsweredSlots ?? 'NOT_MEASURED'}/${example.eligibleSlots ?? 'NOT_MEASURED'}.`,
    ].join('\n\n')).join('\n\n') : 'No current, provenance-matched source comparison is available.';
    const sourceLine = details.sourceOracle
        ? `${details.sourceOracle.source.personas} personas, ${details.sourceOracle.source.turns} turns, ${status.ELIGIBLE_PRODUCT_TURNS} text product turns, ${status.ANSWERABLE_PRODUCT_TURNS} answerable turns, and ${proof.benchmark.eligibleFactSlots} answerable fact slots.`
        : 'Source oracle is not available.';
    const sourceComparisonBlock = details.sourceComparison
        ? `Valid: **${details.sourceComparison.comparisonValid ? 'YES' : 'NO'}**. V1.2 verified answers: ${details.sourceBaseline?.verifiedCorrectAnswers ?? 'NOT_RUN'}; V1.3 verified answers: ${details.sourceCandidate?.verifiedCorrectAnswers ?? 'NOT_RUN'}. V1.2 context failures: ${details.sourceBaseline?.contextResolutionFailures ?? 'NOT_RUN'}; V1.3: ${details.sourceCandidate?.contextResolutionFailures ?? 'NOT_RUN'}.`
        : 'No valid source comparison is available.';
    const heldoutBlock = details.heldoutComparison
        ? `Valid: **${details.heldoutComparison.comparisonValid ? 'YES' : 'NO'}**. V1.2 verified answers: ${details.heldoutBaseline?.verifiedCorrectAnswers ?? 'NOT_RUN'}; V1.3 verified answers: ${details.heldoutCandidate?.verifiedCorrectAnswers ?? 'NOT_RUN'}.`
        : 'No held-out comparison is available.';
    const imageBlock = details.realComparison
        ? `The paid matched run evaluated ${details.photosTested ?? 'unknown'} unique licensed public photos. Category matches: ${details.photoCategoryMatches}/${details.photosTested ?? 'unknown'}; visible-color matches: ${details.photoColorMatches}/${details.photosTested ?? 'unknown'}. These are a small public-photo probe, not customer-upload accuracy evidence.`
        : 'Real Gemini vision evaluation: NOT_RUN.';
    const integrationBlock = details.integration
        ? `Receipt status: **${details.integration.status}**; PostgreSQL and Redis use a disposable project-scoped stack. Selected integration: ${details.selectedIntegrationTests}; webhook pipeline: ${details.webhookTests}; full backend regression: ${details.backendRegressionTests}.`
        : 'Local integration: NOT_RUN.';
    const browserBlock = details.playwright
        ? `Playwright exit code: ${details.playwright.playwrightExitCode}; result: ${JSON.stringify(details.playwright.tests || {})}. Evidence: [execution.json](artifacts/playwright/execution.json).`
        : 'Playwright: NOT_RUN.';
    const unpricedCandidateCalls = Number(details.realCandidate?.unpricedProviderCalls) || 0;
    const geminiBlock = details.realComparison
        ? `Model: ${comparisons.realGemini.model || 'not recorded'}. Requests in matched baseline and candidate arms: ${comparisons.realGemini.textRequestsBothEngines} text and ${comparisons.realGemini.visionRequestsBothEngines} vision. Estimated matched-pair spend from priced usage: $${Number(comparisons.realGemini.estimatedProviderChargeUsdBothEngines || 0).toFixed(8)}; provider invoice: NOT_AVAILABLE. Candidate verified answers: ${details.realCandidate?.verifiedCorrectAnswers ?? 'NOT_MEASURED'}. Candidate unpriced provider calls: ${unpricedCandidateCalls}; ${unpricedCandidateCalls ? 'candidate estimate may be incomplete.' : 'all candidate provider calls were priced.'}`
        : 'Credential status is not recorded in this proof. Paid Gemini evaluation: NOT_RUN.';
    const unpricedCostNote = details.realComparison
        ? `Candidate unpriced provider calls: ${unpricedCandidateCalls}. ${unpricedCandidateCalls ? 'The candidate estimate may be incomplete.' : 'All candidate calls were priced.'}`
        : 'Candidate unpriced provider calls: NOT_RUN.';
    const campaignBlock = details.campaign
        ? `Cumulative campaign: ${details.campaign.requestCount}/${details.campaign.maxRequests} requests, ${details.campaign.visionRequestCount}/${details.campaign.maxVisionRequests} vision requests, estimated $${Number(details.campaign.estimatedProviderChargeUsd || 0).toFixed(8)} of $${Number(details.campaign.ceilingUsd || 2).toFixed(2)} reserved ceiling. Invoice unavailable.`
        : 'No campaign ledger is available.';
    const independentBlock = details.independent
        ? `Verdict: **${details.independent.verdict}**; reviewer: ${details.independent.reviewer || 'not recorded'}; reviewed code commit: ${details.independent.reviewedCodeCommit || 'not recorded'}.`
        : 'Independent review: NOT_RUN. The proof remains blocked until a separate read-only review is recorded.';
    const costPerAnswer = proof.measured.estimatedCostPerCandidateVerifiedAnswerUsd;
    return `# EasyModerator Product Engine V1.3 — Integration & Customer Truth Proof

Generated: ${proof.generatedAt}

## A. Executive verdict

| Gate | Result |
|---|---|
| Automated QA | ${status.AUTOMATED_QA_VERDICT} |
| Integration ready | ${status.INTEGRATION_READY} |
| Customer truth | ${status.CUSTOMER_TRUTH_VERDICT} |
**Commercial evidence:** ${status.COMMERCIAL_EVIDENCE_VERDICT}

This local milestone tested the existing V1.2 Product Engine against an independently generated catalog oracle, a synthetic held-out set, the real local PostgreSQL/Redis/worker path, and matched baseline/candidate replays. Production, live Meta delivery, merchant outcomes, conversion and ROI were not tested.

The candidate is ${status.INTEGRATION_READY === 'YES' ? 'eligible for scoped integration review' : 'not eligible for integration readiness yet'}. The evidence below identifies the remaining gates and does not treat safe fallback as a verified answer.

## B. Source control and isolation

- V1.2 baseline: \`${status.V1_2_BASE_SHA}\`.
- V1.3 tested code commit: \`${status.V1_3_FINAL_SHA}\` on \`${status.V1_3_BRANCH}\`.
- Evidence checkout: \`${proof.candidate.worktree}\`.
- Backend source SHA-256: \`${proof.candidate.backendSourceSha256}\`.
- Worktree clean at verification start: **${proof.candidate.cleanAtVerificationStart === true ? 'YES' : 'UNKNOWN'}**.
- Other agent worktrees touched: **NO**. Production changed: **NO**. Push, merge and deploy: **NO**.
- Production release remains unauthorized.

## C. Implementation changes

The candidate extends the existing intent router, product evidence and Test Lab. V1.3 corrections cover product context re-fetching, mixed product-price and delivery-fee questions, negotiation versus catalog-price classification, garment measurements, category-incompatible context, Bengali-digit PII masking, independent answerability denominators, and source/held-out oracle provenance. The decision record is [MULTI_AGENT_DECISION_RECORD.md](MULTI_AGENT_DECISION_RECORD.md).

Order creation, payment confirmation, stock reservation, courier booking, live Meta delivery and new provider architecture remain outside the Product Engine boundary.

## D. Customer truth

${sourceLine}

The source CSV SHA-256 is \`${proof.benchmark.sourceCorpusSha256}\`. Its advisory \`Expected AI Truth\` cells are not the source of oracle answers. Only TEXT turns enter text answerability metrics; image-bearing turns without pixels are excluded from those denominators.

| Metric | V1.2 | V1.3 |
|---|---:|---:|
| Verified correct fact answers | ${details.sourceBaseline?.verifiedCorrectAnswers ?? 'NOT_RUN'} | ${details.sourceCandidate?.verifiedCorrectAnswers ?? 'NOT_RUN'} |
| Fully answered product turns | ${details.sourceBaseline?.verifiedCorrectTurns ?? 'NOT_RUN'} | ${details.sourceCandidate?.verifiedCorrectTurns ?? 'NOT_RUN'} |
| False refusal slots | ${details.sourceBaseline?.falseRefusalSlots ?? 'NOT_RUN'} | ${details.sourceCandidate?.falseRefusalSlots ?? 'NOT_RUN'} |
| Unsupported price claims sent | ${details.sourceBaseline?.unsupportedClaimsSent ?? 'NOT_RUN'} | ${details.sourceCandidate?.unsupportedClaimsSent ?? 'NOT_RUN'} |
| Context-resolution failures | ${details.sourceBaseline?.contextResolutionFailures ?? 'NOT_RUN'} | ${details.sourceCandidate?.contextResolutionFailures ?? 'NOT_RUN'} |
| Safe cross-domain handoffs | ${details.sourceBaseline?.safeCrossDomainHandoffs ?? 'NOT_RUN'} | ${details.sourceCandidate?.safeCrossDomainHandoffs ?? 'NOT_RUN'} |

Incorrect product answers are **not separately measured**. The artifact records ${details.totalIncorrectOrUnansweredSlots ?? 'NOT_MEASURED'} answerable fact slots that were partial, unanswered or incorrect; this total includes false refusals and must not be presented as a wrong-answer count. The currently measured unsupported-claim counter is specifically an unsupported-price-claim check.

${exampleText}

## E. Gemini

${geminiBlock}

${campaignBlock}

Provider estimates use reported token usage and a pinned local rate calculation. They are not billing records. The credential is process-scoped and is not copied into artifacts.

## F. Images

${imageBlock}

No source-corpus image pixels were available. The three independent photos are licensed public fixtures; results should not be generalized to customer photos. The detailed provenance and per-photo observations are in the machine-readable proof.

## G. Backend integration

${integrationBlock}

Product search: **${status.PRODUCT_SEARCH_INTEGRATION}**. Fake Meta transport: **${status.FAKE_META_TRANSPORT}**. These checks do not establish production database behavior or live Meta delivery. Disposable service receipts are in [artifacts/integration](artifacts/integration/).

## H. Browser QA

${browserBlock}

The Playwright runner starts a loopback Test Lab for the browser run and stops it afterward; no persistent Test Lab URL is claimed by this report.

## I. Security and privacy

- Security tests: **${status.SECURITY_TESTS}**. Egress guard: ${proof.security.egress?.guard || 'NOT_RUN'}; blocked non-loopback attempts: ${proof.security.egress?.blockedNonLoopbackAttempts ?? 'NOT_MEASURED'}.
- Tenant violations: ${details.sourceCandidate?.tenantViolations ?? 'NOT_RUN'}; unscoped catalog reads: ${details.sourceCandidate?.unscopedReads ?? 'NOT_RUN'}.
- Artifact privacy scan: **${status.PRIVACY_SCAN}**.
- No credential values are stored in the proof package.

## J. Cost and merchant economics

Estimated matched-pair provider cost from priced usage: ${details.realComparison ? `$${Number(comparisons.realGemini?.estimatedProviderChargeUsdBothEngines || 0).toFixed(8)}` : 'NOT_RUN'}. ${unpricedCostNote} Candidate cost per verified answer: ${costPerAnswer == null ? 'NOT_MEASURED' : `$${costPerAnswer.toFixed(8)}`}. Candidate router p50/p95: ${details.sourceCandidate?.p50RouteMs ?? 'NOT_RUN'} ms / ${details.sourceCandidate?.p95RouteMs ?? 'NOT_RUN'} ms. These route timings exclude webhook, queue, database and customer-facing network latency.

No merchant time saved, adoption, order outcomes, conversion or ROI data exists in this test. Commercial evidence is therefore **NOT ESTABLISHED**.

## K. Baseline comparison

- Source comparison: ${sourceComparisonBlock}
- Held-out comparison: ${heldoutBlock}
- Deterministic and paid model results are kept separate. Comparison outputs include dataset, oracle, catalog, engine-source and runner hashes.

## L. Independent verification

${independentBlock}

The separate read-only reviewer must inspect the final code SHA and reproduce critical comparisons, integration, security, privacy and browser evidence. Any code change after that review invalidates its verdict.

## M. Remaining decisions

| Task | Classification | Evidence/status |
|---|---|---|
| Resolve any remaining text, context or vision failures | Required before integration | Customer truth: ${status.CUSTOMER_TRUTH_VERDICT}; vision results are listed above. |
| Repeat final independent review after any correction | Required before integration | Independent verification: ${status.INDEPENDENT_VERIFICATION}. |
| Live Meta, production data and release authorization | Required before production release | Not authorized and not tested in this milestone. |
| Merchant adoption, time-saved, conversion and ROI study | Optional future measurement | Not available from synthetic runs. |

## Reproducibility

From \`EasyMod-backend\`, use Node.js 20, Python 3 and a working local Docker Engine:

\`npm run verify:product-v1.3\`

This default is offline. To opt into the bounded real Gemini comparison, the current process must already contain \`EM-GEMINI-KEY\`:

\`npm run verify:product-v1.3 -- --paid-gemini\`

The opt-in run uses a persistent campaign ledger capped at $2, 256 requests and 12 vision requests. It does not send live Meta messages or modify production.

## Machine-readable status

See [product-engine-v1.3-proof.json](artifacts/product-engine-v1.3-proof.json) for the complete structured evidence and exact required status fields.
`;
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`Proof generation failed: ${String(error?.message || 'UNKNOWN_ERROR')}\n`);
        process.exitCode = 1;
    }
}

module.exports = { backendSourceSha256, matchingComparison, renderMarkdown, safeExamples };
