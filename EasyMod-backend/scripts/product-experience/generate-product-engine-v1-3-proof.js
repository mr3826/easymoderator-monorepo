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
const CAMPAIGN_ID = process.env.LAB_CAMPAIGN_ID || 'v13-cf6f18b2-2a9a-4831-ad42-2b8509bfcd35';
const { summarizeTurnEvidence } = require('./turn-evidence-metrics');
const PROOF_JSON = path.join(ARTIFACT_ROOT, 'product-engine-v1.3-proof.json');
const PROOF_MARKDOWN = path.join(DOC_ROOT, 'PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const REQUIRED_VISUAL_CASES = Object.freeze([
    'Single product, clean photograph',
    'Multiple photographed angles',
    'Side-view-only product',
    'Product worn by a model',
    'Product with accessories not included',
    'Product with printed price',
    'Conflicting currency symbol',
    'Similar-looking products',
    'Color variation',
    'Blurred product',
    'Partially occluded product',
    'Non-catalog product',
    'Multiple products in the same image',
    'Screenshot containing extraneous text',
    'Image with malicious or misleading embedded text',
]);
const summarizeRequiredVisualCaseCoverage = photoCases => {
    const fixtures = Array.isArray(photoCases) ? photoCases : [];
    const singleCleanFixtureIds = fixtures.filter(item => item.fixtureId === 'handloom-kurta')
        .map(item => item.fixtureId);
    return {
        requiredCaseTypes: REQUIRED_VISUAL_CASES.length,
        representedCaseTypes: singleCleanFixtureIds.length ? 1 : 0,
        cases: REQUIRED_VISUAL_CASES.map((name, index) => ({
            name,
            status: index === 0 && singleCleanFixtureIds.length ? 'REPRESENTED' : 'NOT_COVERED',
            fixtureIds: index === 0 ? singleCleanFixtureIds : [],
        })),
    };
};
const worktreeStatusFields = (verificationReceipt, cleanAtProofGeneration) => ({
    WORKTREE_CLEAN: cleanAtProofGeneration,
    WORKTREE_CLEAN_AT_VERIFICATION_START: typeof verificationReceipt?.worktreeCleanAtStart === 'boolean'
        ? verificationReceipt.worktreeCleanAtStart : 'UNKNOWN',
    WORKTREE_CLEAN_AT_PROOF_GENERATION: cleanAtProofGeneration,
});

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

const collectGeminiProPhotoDiagnostics = (runRoot, repositoryRoot = REPO_ROOT, currentRunnerSourceSha256 = null) => {
    const transportRelativePath = 'EasyMod-backend/scripts/product-experience/gemini-pro-diagnostic-transport.js';
    const transportPath = path.join(repositoryRoot, transportRelativePath);
    const transportExists = fs.existsSync(transportPath);
    const transportSha256 = transportExists ? sha256(fs.readFileSync(transportPath)) : null;
    const transportStat = transportExists ? fs.statSync(transportPath) : null;
    return jsonFiles(runRoot)
        .filter(filename => filename.endsWith('.pro-photo.json'))
        .map(filename => {
            try {
                const receipt = readJson(filename);
                if (receipt.model !== 'gemini-3.1-pro-preview' || !String(receipt.experiment || '').startsWith('bounded-gemini-pro-production-photo-extraction')) return null;
                const runId = path.basename(filename, '.pro-photo.json');
                const usesDedicatedTransport = receipt.experiment === 'bounded-gemini-pro-production-photo-extraction-low-thinking';
                const sourceAttestationPath = path.join(runRoot, `${runId}.pro-photo-provenance.json`);
                const sourceAttestation = fs.existsSync(sourceAttestationPath) ? readJson(sourceAttestationPath) : null;
                const recordedTransportSourceSha256 = receipt.diagnosticTransportSourceSha256 || null;
                const manifestBindsTransport = usesDedicatedTransport && recordedTransportSourceSha256 === transportSha256
                    && receipt.runnerSourceSha256 === currentRunnerSourceSha256;
                const budget = receipt.evaluationBudget || {};
                const campaign = receipt.campaignBudget || {};
                const cases = Array.isArray(receipt.photoEvaluation?.cases) ? receipt.photoEvaluation.cases : [];
                return {
                    runId,
                    campaignId: receipt.campaignId || null,
                    experiment: receipt.experiment,
                    model: receipt.model,
                    thinkingLevel: receipt.thinkingLevel || 'PROVIDER_DEFAULT_NOT_CAPTURED',
                    configuredRouteMaxOutputTokens: Number.isFinite(receipt.configuredRouteMaxOutputTokens)
                        ? receipt.configuredRouteMaxOutputTokens : null,
                    effectiveMaxOutputTokens: Number.isFinite(receipt.effectiveMaxOutputTokens)
                        ? receipt.effectiveMaxOutputTokens : null,
                    startedAt: receipt.startedAt || null,
                    completedAt: receipt.completedAt || null,
                    engineSourceSha256: receipt.engineSourceSha256 || null,
                    recordedRunnerSourceSha256: receipt.runnerSourceSha256 || null,
                    photosTested: Number.isFinite(receipt.photoEvaluation?.photosTested) ? receipt.photoEvaluation.photosTested : null,
                    categoryMatches: Number.isFinite(receipt.photoEvaluation?.categoryMatches) ? receipt.photoEvaluation.categoryMatches : null,
                    colorMatches: Number.isFinite(receipt.photoEvaluation?.colorMatches) ? receipt.photoEvaluation.colorMatches : null,
                    providerRequests: Number.isFinite(budget.requestCount) ? budget.requestCount : null,
                    visionRequests: Number.isFinite(budget.visionRequestCount) ? budget.visionRequestCount : null,
                    estimatedProviderChargeUsd: Number.isFinite(budget.estimatedProviderChargeUsd)
                        ? budget.estimatedProviderChargeUsd : null,
                    reservedWorstCaseUsd: Number.isFinite(campaign.reservedWorstCaseUsd) ? campaign.reservedWorstCaseUsd : null,
                    campaignCeilingUsd: Number.isFinite(campaign.ceilingUsd) ? campaign.ceilingUsd : null,
                    providerInvoice: campaign.providerInvoice || 'NOT_AVAILABLE',
                    transportProvenance: usesDedicatedTransport ? {
                        sourcePath: transportRelativePath,
                        recordedDiagnosticTransportSourceSha256: recordedTransportSourceSha256,
                        postRunObservedSourceSha256: sourceAttestation?.observedTransportSourceSha256BeforeEdit || null,
                        currentSourceSha256: transportSha256,
                        currentSourceLastWriteUtc: transportStat?.mtime?.toISOString() || null,
                        preEditObservedSourceLastWriteUtc: sourceAttestation?.observedTransportLastWriteUtc || null,
                        preEditObservedSourceLastWritePrecededRequest: sourceAttestation?.sourceLastWritePrecededRequest === true,
                        recordedRunnerManifestIncludedTransport: manifestBindsTransport,
                        currentRunnerSourceSha256,
                        status: manifestBindsTransport ? 'PASS' : 'INCOMPLETE_CALL_TIME_SOURCE_BINDING',
                        limitation: 'The run receipt predates this provenance fix and its recorded runner hash omitted this transport. A separate post-run source observation is not an atomic or cryptographic call-time attestation and does not make this receipt fully code-bound.',
                    } : {
                        sourcePath: 'EasyMod-backend/scripts/product-experience/gemini-evaluation-client.js',
                        recordedRunnerSourceSha256: receipt.runnerSourceSha256 || null,
                        status: 'LEGACY_DIAGNOSTIC_PATH',
                    },
                    calls: Array.isArray(budget.calls) ? budget.calls.map(call => ({
                        callId: typeof call.callId === 'string' ? call.callId : null,
                        status: call.status || null,
                        vision: call.vision === true,
                        thinkingLevel: call.thinkingLevel || receipt.thinkingLevel || 'PROVIDER_DEFAULT_NOT_CAPTURED',
                        inputTokens: Number.isFinite(call.inputTokens) ? call.inputTokens : null,
                        outputTokens: Number.isFinite(call.outputTokens) ? call.outputTokens : null,
                        thinkingTokens: Number.isFinite(call.thinkingTokens) ? call.thinkingTokens : null,
                        candidateTokens: Number.isFinite(call.candidateTokens) ? call.candidateTokens
                            : Number.isFinite(call.outputTokens) && Number.isFinite(call.thinkingTokens)
                                ? Math.max(0, call.outputTokens - call.thinkingTokens) : null,
                        finishReason: ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER'].includes(call.finishReason)
                            ? call.finishReason : null,
                        maxOutputTokens: Number.isFinite(call.maxOutputTokens) ? call.maxOutputTokens : null,
                        latencyMs: Number.isFinite(call.latencyMs) ? call.latencyMs : null,
                        estimatedProviderChargeUsd: Number.isFinite(call.estimatedProviderChargeUsd)
                            ? call.estimatedProviderChargeUsd : null,
                    })) : [],
                    cases: cases.map(item => ({
                        fixtureId: typeof item.fixtureId === 'string' ? item.fixtureId : null,
                        fixtureSha256: typeof item.fixtureSha256 === 'string' ? item.fixtureSha256 : null,
                        status: item.status || null,
                        labelPresenceProxy: item.labelPresenceProxy === true || item.schemaValid === true,
                        observedCategory: typeof item.observedCategory === 'string' ? item.observedCategory : null,
                        providerResponseRedacted: typeof item.providerResponseRedacted === 'string' ? item.providerResponseRedacted : null,
                        categoryMatch: item.categoryMatch === true,
                        observedDominantColor: typeof item.observedDominantColor === 'string' ? item.observedDominantColor : null,
                        dominantColorMatch: item.dominantColorMatch === true,
                        unverifiedMaterialFieldPopulated: item.unverifiedMaterialFieldPopulated === true,
                        finishReason: ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER'].includes(item.finishReason)
                            ? item.finishReason : null,
                        maxOutputTokens: Number.isFinite(item.maxOutputTokens) ? item.maxOutputTokens : null,
                        usage: item.usage && typeof item.usage === 'object' ? {
                            promptTokenCount: Number.isFinite(item.usage.promptTokenCount) ? item.usage.promptTokenCount : null,
                            candidatesTokenCount: Number.isFinite(item.usage.candidatesTokenCount) ? item.usage.candidatesTokenCount : null,
                            totalTokenCount: Number.isFinite(item.usage.totalTokenCount) ? item.usage.totalTokenCount : null,
                            thoughtsTokenCount: Number.isFinite(item.usage.thoughtsTokenCount) ? item.usage.thoughtsTokenCount : null,
                        } : null,
                        providerLatencyMs: Number.isFinite(item.providerLatencyMs) ? item.providerLatencyMs : null,
                        estimatedProviderChargeUsd: Number.isFinite(item.estimatedProviderChargeUsd)
                            ? item.estimatedProviderChargeUsd : null,
                    })),
                };
            } catch (_) { return null; }
        })
        .filter(Boolean)
        .sort((left, right) => Date.parse(left.startedAt || '') - Date.parse(right.startedAt || ''));
};

const collectGeminiLitePhotoDiagnostics = (runRoot, currentHead, currentEngineSourceSha256, currentRunnerSourceSha256) => jsonFiles(runRoot)
    .filter(filename => filename.endsWith('.lite-photo.json'))
    .map(filename => {
        try {
            const receipt = readJson(filename);
            if (receipt.experiment !== 'bounded-gemini-lite-production-photo-extraction-follow-up'
                || receipt.model !== 'gemini-3.1-flash-lite') return null;
            const budget = receipt.evaluationBudget || {};
            const campaign = receipt.campaignBudget || {};
            const photoEvaluation = receipt.photoEvaluation || {};
            const cases = Array.isArray(photoEvaluation.cases) ? photoEvaluation.cases : [];
            const sourceBound = receipt.sourceRevision === currentHead
                && receipt.engineSourceSha256 === currentEngineSourceSha256
                && receipt.runnerSourceSha256 === currentRunnerSourceSha256;
            return {
                runId: path.basename(filename, '.lite-photo.json'),
                campaignId: receipt.campaignId || null,
                startedAt: receipt.startedAt || null,
                completedAt: receipt.completedAt || null,
                model: receipt.model,
                sourceRevision: receipt.sourceRevision || null,
                engineSourceSha256: receipt.engineSourceSha256 || null,
                runnerSourceSha256: receipt.runnerSourceSha256 || null,
                currentCodeBinding: sourceBound ? 'PASS' : 'DIFFERENT',
                parserCorrection: receipt.parserCorrection || null,
                photosTested: Number.isFinite(photoEvaluation.photosTested) ? photoEvaluation.photosTested : null,
                categoryMatches: Number.isFinite(photoEvaluation.categoryMatches) ? photoEvaluation.categoryMatches : null,
                colorMatches: Number.isFinite(photoEvaluation.colorMatches) ? photoEvaluation.colorMatches : null,
                identityScored: photoEvaluation.identityScored === true,
                providerRequests: Number.isFinite(budget.requestCount) ? budget.requestCount : null,
                visionRequests: Number.isFinite(budget.visionRequestCount) ? budget.visionRequestCount : null,
                estimatedProviderChargeUsd: Number.isFinite(budget.estimatedProviderChargeUsd)
                    ? budget.estimatedProviderChargeUsd : null,
                reservedWorstCaseUsd: Number.isFinite(campaign.reservedWorstCaseUsd) ? campaign.reservedWorstCaseUsd : null,
                campaignCeilingUsd: Number.isFinite(campaign.ceilingUsd) ? campaign.ceilingUsd : null,
                providerInvoice: receipt.providerInvoice || 'NOT_AVAILABLE',
                cases: cases.map(item => ({
                    fixtureId: typeof item.fixtureId === 'string' ? item.fixtureId : null,
                    fixtureSha256: typeof item.fixtureSha256 === 'string' ? item.fixtureSha256 : null,
                    sourcePageUrl: typeof item.sourcePageUrl === 'string' ? item.sourcePageUrl : null,
                    author: typeof item.author === 'string' ? item.author : null,
                    license: typeof item.license === 'string' ? item.license : null,
                    licenseUrl: typeof item.licenseUrl === 'string' ? item.licenseUrl : null,
                    classification: typeof item.classification === 'string' ? item.classification : null,
                    status: item.status || null,
                    productionObservationParsed: item.productionObservationParsed === true,
                    labelPresenceProxy: item.labelPresenceProxy === true,
                    observedCategory: typeof item.observedCategory === 'string' ? item.observedCategory : null,
                    observedDominantColor: typeof item.observedDominantColor === 'string' ? item.observedDominantColor : null,
                    providerResponseRedacted: typeof item.providerResponseRedacted === 'string'
                        ? item.providerResponseRedacted : null,
                    categoryMatch: item.categoryMatch === true,
                    dominantColorMatch: item.dominantColorMatch === true,
                    unverifiedMaterialFieldPopulated: item.unverifiedMaterialFieldPopulated === true,
                    catalogIdentityMatch: typeof item.catalogIdentityMatch === 'boolean' ? item.catalogIdentityMatch : null,
                    providerCallId: item.providerCallId || null,
                    requestId: item.requestId || null,
                    finishReason: item.finishReason || null,
                    maxOutputTokens: Number.isFinite(item.maxOutputTokens) ? item.maxOutputTokens : null,
                    usage: item.usage && typeof item.usage === 'object' ? {
                        promptTokenCount: Number.isFinite(item.usage.promptTokenCount) ? item.usage.promptTokenCount : null,
                        candidatesTokenCount: Number.isFinite(item.usage.candidatesTokenCount) ? item.usage.candidatesTokenCount : null,
                        totalTokenCount: Number.isFinite(item.usage.totalTokenCount) ? item.usage.totalTokenCount : null,
                        thoughtsTokenCount: Number.isFinite(item.usage.thoughtsTokenCount) ? item.usage.thoughtsTokenCount : null,
                    } : null,
                    providerLatencyMs: Number.isFinite(item.providerLatencyMs) ? item.providerLatencyMs : null,
                    estimatedProviderChargeUsd: Number.isFinite(item.estimatedProviderChargeUsd)
                        ? item.estimatedProviderChargeUsd : null,
                    routeLatencyMs: Number.isFinite(item.routeLatencyMs) ? item.routeLatencyMs : null,
                    customerFacingReplyRedacted: typeof item.customerFacingReplyRedacted === 'string'
                        ? item.customerFacingReplyRedacted : null,
                    productCatalogIdentityScored: item.productCatalogIdentityScored === true,
                })),
            };
        } catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.startedAt || '') - Date.parse(right.startedAt || ''));

const reconcileV13CampaignBudget = (workspaceRoot, authorizedAggregateBudgetUsd = 10, v1_2ProofPath = null) => {
    const candidates = [];
    const malformedLedgerSnapshots = [];
    if (fs.existsSync(workspaceRoot)) {
        for (const directory of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
            if (!directory.isDirectory() || !directory.name.startsWith('_product-engine-v1-3-evidence')) continue;
            const campaignRoot = path.join(workspaceRoot, directory.name, 'campaigns');
            if (!fs.existsSync(campaignRoot)) continue;
            for (const campaignDirectory of fs.readdirSync(campaignRoot, { withFileTypes: true })) {
                if (!campaignDirectory.isDirectory()) continue;
                const ledgerPath = path.join(campaignRoot, campaignDirectory.name, 'budget-ledger.json');
                if (!fs.existsSync(ledgerPath)) continue;
                try {
                    const ledger = readJson(ledgerPath);
                    if (typeof ledger.campaignId !== 'string') {
                        malformedLedgerSnapshots.push({
                            sourcePath: path.relative(workspaceRoot, ledgerPath).replace(/\\/g, '/'),
                            reason: 'MISSING_OR_INVALID_CAMPAIGN_ID',
                        });
                        continue;
                    }
                    if (!ledger.campaignId.startsWith('v13-')) continue;
                    const updatedAt = Date.parse(ledger.updatedAt || '');
                    candidates.push({ ledger, ledgerPath, sortTime: Number.isFinite(updatedAt) ? updatedAt : fs.statSync(ledgerPath).mtimeMs });
                } catch (_) {
                    malformedLedgerSnapshots.push({
                        sourcePath: path.relative(workspaceRoot, ledgerPath).replace(/\\/g, '/'),
                        reason: 'INVALID_JSON',
                    });
                }
            }
        }
    }
    const latestByCampaign = new Map();
    for (const candidate of candidates) {
        const prior = latestByCampaign.get(candidate.ledger.campaignId);
        if (!prior || candidate.sortTime > prior.sortTime) latestByCampaign.set(candidate.ledger.campaignId, candidate);
    }
    const campaigns = [...latestByCampaign.values()].map(({ ledger, ledgerPath }) => ({
        campaignId: ledger.campaignId,
        sourcePath: path.relative(workspaceRoot, ledgerPath).replace(/\\/g, '/'),
        sourceLedgerSha256: sha256(fs.readFileSync(ledgerPath)),
        updatedAt: ledger.updatedAt || null,
        requestCount: Number.isFinite(ledger.requestCount) ? ledger.requestCount : null,
        visionRequestCount: Number.isFinite(ledger.visionRequestCount) ? ledger.visionRequestCount : null,
        unknownUsageRequestCount: Number.isFinite(ledger.unpricedRequestCount) ? ledger.unpricedRequestCount : null,
        estimatedProviderChargeUsd: Number.isFinite(ledger.estimatedProviderChargeUsd) ? ledger.estimatedProviderChargeUsd : null,
        reservedWorstCaseUsd: Number.isFinite(ledger.reservedWorstCaseUsd) ? ledger.reservedWorstCaseUsd : null,
        campaignCeilingUsd: Number.isFinite(ledger.ceilingUsd) ? ledger.ceilingUsd : null,
        providerInvoice: ledger.providerInvoice || 'NOT_AVAILABLE',
    })).sort((left, right) => left.campaignId.localeCompare(right.campaignId));
    const sum = (key) => campaigns.every(item => Number.isFinite(item[key]))
        ? campaigns.reduce((total, item) => total + item[key], 0) : null;
    let v1_2ExposureUsd = null;
    let v1_2ProofSourcePath = null;
    let v1_2ProofSha256 = null;
    if (v1_2ProofPath && fs.existsSync(v1_2ProofPath)) {
        try {
            const v1_2Proof = readJson(v1_2ProofPath);
            const value = v1_2Proof.cumulativeProviderCostAccounting?.conservativeTaskSeriesExposureUsd;
            if (Number.isFinite(value)) {
                v1_2ExposureUsd = value;
                v1_2ProofSourcePath = path.relative(workspaceRoot, v1_2ProofPath).replace(/\\/g, '/');
                v1_2ProofSha256 = sha256(fs.readFileSync(v1_2ProofPath));
            }
        } catch (_) { /* missing or malformed historical proof remains unmeasured */ }
    }
    const v1_3ReservedUsd = sum('reservedWorstCaseUsd');
    const combinedReservedUsd = Number.isFinite(v1_3ReservedUsd) && Number.isFinite(v1_2ExposureUsd)
        ? v1_3ReservedUsd + v1_2ExposureUsd : null;
    const ledgerSnapshotsComplete = malformedLedgerSnapshots.length === 0;
    return {
        reconciliationMethod: 'latest campaign ledger per distinct campaignId across sibling _product-engine-v1-3-evidence* roots',
        campaigns,
        ledgerSnapshotsComplete,
        malformedLedgerSnapshots,
        distinctCampaignCount: campaigns.length,
        requestCount: sum('requestCount'),
        visionRequestCount: sum('visionRequestCount'),
        unknownUsageRequestCount: sum('unknownUsageRequestCount'),
        estimatedProviderChargeUsd: sum('estimatedProviderChargeUsd'),
        reservedWorstCaseUsd: v1_3ReservedUsd,
        sumOfPerCampaignCeilingsUsd: sum('campaignCeilingUsd'),
        v1_2ConservativeTaskSeriesExposureUsd: v1_2ExposureUsd,
        v1_2ProofSourcePath,
        v1_2ProofSha256,
        combinedReservedExposureUsd: combinedReservedUsd,
        authorizedAggregateBudgetUsd,
        remainingAggregateAuthorizationUsd: ledgerSnapshotsComplete && Number.isFinite(combinedReservedUsd)
            ? authorizedAggregateBudgetUsd - combinedReservedUsd : null,
        status: !ledgerSnapshotsComplete ? 'INCOMPLETE_MALFORMED_LEDGER_SNAPSHOTS' : Number.isFinite(combinedReservedUsd)
            ? (combinedReservedUsd <= authorizedAggregateBudgetUsd ? 'WITHIN_AUTHORIZATION_BY_MANUAL_RECONCILIATION' : 'EXCEEDS_AUTHORIZATION')
            : 'INCOMPLETE',
        aggregateCapEnforcement: 'MANUAL_RECONCILIATION_ONLY; INDIVIDUAL_CAMPAIGN_LEDGERS_DO_NOT_ENFORCE_A_SHARED_CAP',
        providerInvoice: 'NOT_AVAILABLE',
    };
};

const summarizeGeminiProDiagnostics = (diagnostics = []) => {
    const sum = key => diagnostics.every(item => Number.isFinite(item[key]))
        ? diagnostics.reduce((total, item) => total + item[key], 0) : null;
    const cases = diagnostics.flatMap(item => item.cases || []);
    return {
        runCount: diagnostics.length,
        providerRequests: sum('providerRequests'),
        visionRequests: sum('visionRequests'),
        estimatedProviderChargeUsd: sum('estimatedProviderChargeUsd'),
        reservedWorstCaseUsd: sum('reservedWorstCaseUsd'),
        campaignCeilingsUsd: sum('campaignCeilingUsd'),
        repeatedPhotoObservations: cases.length,
        categoryMatchesAcrossRepeatedObservations: cases.filter(item => item.categoryMatch === true).length,
        colorMatchesAcrossRepeatedObservations: cases.filter(item => item.dominantColorMatch === true).length,
        providerInvoice: diagnostics.length ? 'NOT_AVAILABLE' : 'NOT_RUN',
    };
};

const newestMatching = (directory, predicate) => jsonFiles(directory)
    .map(filename => {
        try {
            const value = readJson(filename);
            const recordedTime = Date.parse(value.completedAt || value.updatedAt || value.generatedAt || '');
            return {
                filename,
                value,
                sortTime: Number.isFinite(recordedTime) ? recordedTime : fs.statSync(filename).mtimeMs,
            };
        } catch (_) { return null; }
    })
    .filter(item => item && predicate(item.value, item.filename))
    .sort((left, right) => right.sortTime - left.sortTime)[0] || null;

const matchesCurrentVerificationCommit = (receipt, head) => receipt?.candidateCommit === head;
const independentVerificationStatus = (review, head, backendSourceSha, runnerSourceSha) => {
    if (!review) return 'NOT_RUN';
    const currentCandidate = review.reviewedCodeCommit === head
        && review.reviewedBackendSourceSha256 === backendSourceSha
        && review.reviewedRunnerSourceSha256 === runnerSourceSha;
    if (!currentCandidate) return 'STALE';
    return ['PASS', 'FAIL', 'BLOCKED'].includes(review.verdict) ? review.verdict : 'NOT_MEASURED';
};
const independentVerificationMatches = (review, head, backendSourceSha, runnerSourceSha) => independentVerificationStatus(
    review, head, backendSourceSha, runnerSourceSha,
) === 'PASS';

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
const assessRealGeminiQuality = (comparison, candidate, expected = null) => {
    if (!comparison) return { status: 'NOT_RUN', metricsAvailable: false, missingMetrics: [], failedMetrics: [] };
    if (comparison.comparisonValid !== true) return { status: 'NOT_MEASURED', metricsAvailable: false, missingMetrics: [], failedMetrics: [] };
    const requiredMetrics = [
        'unsupportedClaimsSent', 'falseRefusalSlots', 'contextResolutionFailures', 'unsafeCrossDomainHandoffs',
        'falseRefusalExpectedTurns', 'falseRefusalEvaluatedTurns',
        'verifiedCorrectAnswers', 'eligibleFactSlots', 'evaluatedFactSlots',
        'verifiedCorrectTurns', 'evaluatedAnswerableProductTurns',
        'contextDependentAnswerableTurns', 'evaluatedContextDependentAnswerableTurns',
        'crossDomainHandoffTurns', 'evaluatedCrossDomainHandoffTurns',
        'sourceTurns', 'routeExecutedTurns', 'routeNotRunTurns',
    ];
    const missingMetrics = requiredMetrics.filter(name => !Number.isFinite(candidate?.[name]));
    if (missingMetrics.length) return { status: 'NOT_MEASURED', metricsAvailable: false, missingMetrics, failedMetrics: [] };
    const zeroRequired = ['unsupportedClaimsSent', 'falseRefusalSlots', 'contextResolutionFailures', 'unsafeCrossDomainHandoffs'];
    const failedMetrics = zeroRequired.filter(name => candidate[name] !== 0);
    if (candidate.eligibleFactSlots <= 0 || candidate.evaluatedFactSlots <= 0 || candidate.evaluatedAnswerableProductTurns <= 0) {
        failedMetrics.push('nonEmptyDenominators');
    }
    if (candidate.verifiedCorrectAnswers !== candidate.eligibleFactSlots
        || candidate.evaluatedFactSlots !== candidate.eligibleFactSlots) failedMetrics.push('factSlotCoverage');
    if (candidate.verifiedCorrectTurns !== candidate.evaluatedAnswerableProductTurns) failedMetrics.push('turnCoverage');
    if (candidate.evaluatedContextDependentAnswerableTurns !== candidate.contextDependentAnswerableTurns) {
        failedMetrics.push('contextTurnCoverage');
    }
    if (candidate.falseRefusalEvaluatedTurns !== candidate.falseRefusalExpectedTurns) {
        failedMetrics.push('falseRefusalCoverage');
    }
    if (candidate.evaluatedCrossDomainHandoffTurns !== candidate.crossDomainHandoffTurns) {
        failedMetrics.push('crossDomainHandoffCoverage');
    }
    if (candidate.routeNotRunTurns !== 0 || candidate.routeExecutedTurns !== candidate.sourceTurns) {
        failedMetrics.push('routeCoverage');
    }
    if (expected?.sourceTurns !== undefined && candidate.sourceTurns !== expected.sourceTurns) {
        failedMetrics.push('oracleSourceTurnDenominator');
    }
    if (expected?.eligibleFactSlots !== undefined && candidate.eligibleFactSlots !== expected.eligibleFactSlots) {
        failedMetrics.push('oracleFactSlotDenominator');
    }
    if (expected?.answerableProductTurns !== undefined
        && candidate.evaluatedAnswerableProductTurns !== expected.answerableProductTurns) failedMetrics.push('oracleTurnDenominator');
    if (expected?.falseRefusalExpectedTurns !== undefined
        && candidate.falseRefusalExpectedTurns !== expected.falseRefusalExpectedTurns) failedMetrics.push('oracleFalseRefusalTurnDenominator');
    if (expected?.contextDependentAnswerableTurns !== undefined
        && candidate.contextDependentAnswerableTurns !== expected.contextDependentAnswerableTurns) failedMetrics.push('oracleContextTurnDenominator');
    if (expected?.crossDomainHandoffTurns !== undefined
        && candidate.crossDomainHandoffTurns !== expected.crossDomainHandoffTurns) failedMetrics.push('oracleCrossDomainHandoffDenominator');
    return { status: failedMetrics.length ? 'FAIL' : 'PASS', metricsAvailable: true, missingMetrics: [], failedMetrics };
};
const runArtifactFor = (entry, engineName) => {
    const result = entry?.value.results?.find(item => item.engine === engineName);
    const filename = result?.artifactPath ? pathInside(ARTIFACT_ROOT, result.artifactPath) : null;
    if (!filename || !fs.existsSync(filename)) return null;
    try { return readJson(filename); } catch (_) { return null; }
};

const metric = value => Number.isFinite(value) ? value : 'NOT_MEASURED';
const percent = (numerator, denominator) => denominator > 0 ? `${(100 * numerator / denominator).toFixed(1)}%` : 'NOT_MEASURED';
const privacyScanPassed = report => report?.privacyGateStatus === 'PASS';
const safeText = (value, maxLength = 220) => String(value || '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/(?<!\d)(?:\+?880[\s().-]*)?0?1[3-9](?:[\s().-]*\d){8}(?!\d)/gu, '[PHONE]')
    .replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const passState = value => value === true ? 'PASS' : value === false ? 'FAIL' : 'NOT_RUN';
const isIntegrationServiceReady = (integration, serviceName) => {
    const service = integration?.services?.find(item => item.name === serviceName);
    if (!service) return false;
    if (service.health === 'compose-healthcheck') return true;
    return service.provisioning === 'external-loopback'
        && service.host === '127.0.0.1'
        && Number.isInteger(service.port) && service.port >= 1024 && service.port <= 65535
        && service.health === 'protocol-query'
        && typeof service.version === 'string' && service.version.trim().length > 0;
};
const verificationStepState = step => !step ? 'NOT_RUN'
    : step.timedOut ? 'TIMED_OUT'
        : step.status === 'PASS' ? 'PASS' : 'INCOMPLETE';
const assessPlaywrightExecution = report => {
    if (!report) return 'NOT_RUN';
    if (report.playwrightExitCode === 0 && (report.tests?.failed || 0) === 0 && (report.tests?.passed || 0) > 0) return 'PASS';
    const results = report.tests?.results;
    const noJourneyStarted = report.playwrightExitCode === 4294967295
        && (report.tests?.passed || 0) === 0
        && (report.tests?.failed || 0) > 0
        && Array.isArray(results) && results.length > 0
        && results.every(result => result.duration === '0ms' || result.duration == null);
    return noJourneyStarted ? 'INCOMPLETE' : 'FAIL';
};

const assessGenuinePhotoQuality = (comparison, photos, photosTested) => {
    if (!comparison) return {
        status: 'NOT_RUN', photosTested: null, categoryMatches: null, colorMatches: null,
        failedMetrics: [], missingMetrics: [],
    };
    if (comparison.comparisonValid !== true) return {
        status: 'NOT_MEASURED', photosTested: Number.isFinite(photosTested) ? photosTested : null,
        categoryMatches: null, colorMatches: null, failedMetrics: [], missingMetrics: ['validMatchedComparison'],
    };

    const completeSample = Number.isInteger(photosTested) && photosTested >= 3
        && Array.isArray(photos) && photos.length === photosTested
        && photos.every(photo => photo?.status === 'EXECUTED'
            && typeof photo.fixtureId === 'string' && photo.fixtureId.length > 0
            && /^[a-f0-9]{64}$/i.test(photo.fixtureSha256 || '')
            && typeof photo.categoryMatch === 'boolean'
            && typeof photo.dominantColorMatch === 'boolean')
        && new Set(photos.map(photo => photo.fixtureId)).size === photosTested
        && new Set(photos.map(photo => photo.fixtureSha256)).size === photosTested;
    if (!completeSample) return {
        status: 'NOT_MEASURED', photosTested: Number.isFinite(photosTested) ? photosTested : null,
        categoryMatches: null, colorMatches: null, failedMetrics: [], missingMetrics: ['threePhotoSample'],
    };

    const categoryMatches = photos.filter(photo => photo.categoryMatch === true).length;
    const colorMatches = photos.filter(photo => photo.dominantColorMatch === true).length;
    const failedMetrics = [];
    const missingMetrics = [];
    if (categoryMatches !== photosTested) failedMetrics.push('categoryAccuracy');
    if (colorMatches !== photosTested) failedMetrics.push('colorAccuracy');
    const identityScored = photos.every(photo => photo.productCatalogIdentityScored === true
        && typeof photo.catalogIdentityMatch === 'boolean');
    const identityMatches = identityScored
        ? photos.filter(photo => photo.catalogIdentityMatch === true).length : null;
    if (!identityScored) missingMetrics.push('catalogIdentityAccuracy');
    else if (identityMatches !== photosTested) failedMetrics.push('catalogIdentityAccuracy');
    return {
        status: failedMetrics.length ? 'FAIL' : missingMetrics.length ? 'NOT_MEASURED' : 'PASS', photosTested,
        categoryMatches, colorMatches, identityMatches, failedMetrics, missingMetrics,
    };
};

const assessAutomatedQaVerdict = ({
    hasAutomatedFailure,
    sourceTruthMetricsAvailable,
    qualityPass,
    requiredEvidencePresent,
    automatedStepsPass,
    photoStatus,
}) => {
    if (hasAutomatedFailure || (sourceTruthMetricsAvailable && !qualityPass) || photoStatus === 'FAIL') return 'FAIL';
    return requiredEvidencePresent && automatedStepsPass && photoStatus === 'PASS' ? 'PASS' : 'BLOCKED';
};

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
    const worktreeCleanAtProofGeneration = !git('status', '--porcelain');
    const currentRunnerSourceSha256 = require('./lab-server').getSourceProvenance().runnerSourceSha256;
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
    const realComparisonValid = realComparison?.comparisonValid === true;
    const sourceCandidate = comparisonSummary(sourceComparisonEntry, 'candidate-v1-3');
    const sourceBaseline = comparisonSummary(sourceComparisonEntry, 'baseline-v1-2');
    const heldoutCandidate = comparisonSummary(heldoutComparisonEntry, 'candidate-v1-3');
    const heldoutBaseline = comparisonSummary(heldoutComparisonEntry, 'baseline-v1-2');
    const realBaseline = comparisonSummary(realComparisonEntry, 'baseline-v1-2');
    const realCandidateRaw = comparisonSummary(realComparisonEntry, 'candidate-v1-3');
    const sourceRun = runArtifactFor(sourceComparisonEntry, 'candidate-v1-3');
    const realBaselineRun = runArtifactFor(realComparisonEntry, 'baseline-v1-2');
    const realRun = runArtifactFor(realComparisonEntry, 'candidate-v1-3');
    const realBaselineRunLedgerPath = realBaselineRun?.runId ? path.join(ARTIFACT_ROOT, 'runs', `${realBaselineRun.runId}.budget-ledger.json`) : null;
    const realBaselineRunLedger = realBaselineRunLedgerPath && fs.existsSync(realBaselineRunLedgerPath)
        ? readJson(realBaselineRunLedgerPath) : null;
    const realBaselineRunLedgerSummary = summarizeRunLedger(realBaselineRunLedger);
    const realRunLedgerPath = realRun?.runId ? path.join(ARTIFACT_ROOT, 'runs', `${realRun.runId}.budget-ledger.json`) : null;
    const realRunLedger = realRunLedgerPath && fs.existsSync(realRunLedgerPath) ? readJson(realRunLedgerPath) : null;
    const realRunLedgerSummary = summarizeRunLedger(realRunLedger);
    const realCandidate = realCandidateRaw && Array.isArray(realRun?.turns)
        ? {
            ...realCandidateRaw,
            ...summarizeTurnEvidence(realRun.turns),
            routeExecutedTurns: realRun.summary?.routeExecutedTurns ?? null,
            routeNotRunTurns: realRun.summary?.routeNotRunTurns ?? null,
            ...realRunLedgerSummary,
        }
        : realCandidateRaw ? {
            ...realCandidateRaw,
            ...realRunLedgerSummary,
        } : null;
    const paidRunnerSourceSha256 = realRun?.runnerSourceSha256 || null;
    const runnerProvenanceStatus = !realComparison ? 'NOT_RUN'
        : !paidRunnerSourceSha256 ? 'NOT_MEASURED'
            : paidRunnerSourceSha256 === currentRunnerSourceSha256 ? 'PASS' : 'DIFFERENT';
    const integrationEntry = newestMatching(path.join(ARTIFACT_ROOT, 'integration'), item => item.candidateBackendSourceSha256 === currentEngineHash);
    const integration = integrationEntry?.value || null;
    const regressionEntry = newestMatching(path.join(ARTIFACT_ROOT, 'regression'), item => matchesCurrentVerificationCommit(item, head));
    const regression = regressionEntry?.value || null;
    const playwrightPath = path.join(ARTIFACT_ROOT, 'playwright', 'execution.json');
    const playwright = fs.existsSync(playwrightPath) ? readJson(playwrightPath) : null;
    const privacyPath = path.join(ARTIFACT_ROOT, 'security', 'artifact-privacy-scan.json');
    const privacy = fs.existsSync(privacyPath) ? readJson(privacyPath) : null;
    const independentPath = path.join(DOC_ROOT, 'independent-verification.json');
    const independent = fs.existsSync(independentPath) ? readJson(independentPath) : null;
    const campaignPath = path.join(ARTIFACT_ROOT, 'campaigns', CAMPAIGN_ID, 'budget-ledger.json');
    const campaign = fs.existsSync(campaignPath) ? readJson(campaignPath) : null;
    const campaignSummary = summarizeCampaignLedger(campaign);
    const supplementaryGeminiProPhotoRuns = collectGeminiProPhotoDiagnostics(RUN_ROOT, REPO_ROOT, currentRunnerSourceSha256);
    const supplementaryGeminiProPhotoSummary = summarizeGeminiProDiagnostics(supplementaryGeminiProPhotoRuns);
    const supplementaryGeminiLitePhotoRuns = collectGeminiLitePhotoDiagnostics(
        RUN_ROOT, head, currentEngineHash, currentRunnerSourceSha256
    );
    const currentBoundGeminiLitePhotoRun = supplementaryGeminiLitePhotoRuns
        .filter(run => run.currentCodeBinding === 'PASS').at(-1) || null;
    const v1_2ProofPath = process.env.LAB_V1_2_PROOF_PATH
        || path.join(WORKSPACE_ROOT, '_wt-verified-commerce-v1-2', 'docs', 'ai', 'product-experience-v1-2', 'verified-commerce-proof.json');
    const aggregateBudgetReconciliation = reconcileV13CampaignBudget(WORKSPACE_ROOT, 10, v1_2ProofPath);
    const verificationReceiptPath = process.env.LAB_VERIFY_RECEIPT_PATH || null;
    const verificationReceipt = verificationReceiptPath && fs.existsSync(verificationReceiptPath)
        ? readJson(verificationReceiptPath) : regression;
    const sourceTurns = sourceOracle?.turns || [];
    const textProductTurns = sourceTurns.filter(turn => turn.textOnlyMetricEligible
        && (turn.classificationTags || []).some(tag => ['product_fact_request', 'product_identity_request'].includes(tag)));
    const textAnswerableTurns = sourceTurns.filter(turn => turn.textOnlyMetricEligible && turn.eligibility === 'ANSWERABLE');
    const eligibleFactSlots = textAnswerableTurns.reduce((sum, turn) => sum + (turn.eligibleSlots || []).length, 0);
    const matchedComparisonPhotoCases = realRun?.genuinePhotoEvaluation?.cases || [];
    const observedPhotoCases = currentBoundGeminiLitePhotoRun?.cases
        || (realComparisonValid ? matchedComparisonPhotoCases : []);
    const photos = observedPhotoCases;
    const photosTested = currentBoundGeminiLitePhotoRun?.photosTested
        ?? (realComparisonValid ? (realRun?.genuinePhotoEvaluation?.photosTested ?? null) : null);
    const photoCategoryMatches = photos.filter(photo => photo.categoryMatch === true).length;
    const photoColorMatches = photos.filter(photo => photo.dominantColorMatch === true).length;
    const genuinePhotoQuality = assessGenuinePhotoQuality(realComparison, photos, photosTested);
    const visualCaseCoverage = summarizeRequiredVisualCaseCoverage(photos);
    const measuredRate = (numerator, denominator, evaluated = null) => Number.isFinite(numerator)
        && Number.isFinite(denominator) && denominator > 0
        ? {
            numerator,
            denominator,
            evaluated: Number.isFinite(evaluated) ? evaluated : null,
            rate: numerator / denominator,
        }
        : { status: 'NOT_MEASURED', numerator: null, denominator: null,
            evaluated: Number.isFinite(evaluated) ? evaluated : null, rate: null };
    const notMeasured = note => ({ status: 'NOT_MEASURED', numerator: null, denominator: null, rate: null, note });
    const customerQualityMetricAudit = {
        uncertainty: 'No population confidence intervals were calculated. The benchmark and three public-photo sample are fixed convenience fixtures, not random samples; out-of-sample uncertainty and customer usefulness remain unmeasured.',
        metrics: {
            PRODUCT_IDENTITY_ACCURACY: {
                source: notMeasured('Identity-only accuracy is not isolated from the aggregate fact-slot score.'),
                realGemini: notMeasured('Catalog SKU identity was not scored for the public-photo fixtures.'),
            },
            ANSWERABLE_PRODUCT_RESOLUTION_RATE: {
                source: measuredRate(sourceCandidate?.verifiedCorrectTurns, sourceCandidate?.answerableProductTurns, sourceCandidate?.evaluatedAnswerableProductTurns),
                realGemini: measuredRate(realCandidate?.verifiedCorrectTurns, realCandidate?.answerableProductTurns, realCandidate?.evaluatedAnswerableProductTurns),
            },
            VERIFIED_FACTUAL_ACCURACY: {
                source: measuredRate(sourceCandidate?.verifiedCorrectAnswers, sourceCandidate?.eligibleFactSlots, sourceCandidate?.evaluatedFactSlots),
                realGemini: measuredRate(realCandidate?.verifiedCorrectAnswers, realCandidate?.eligibleFactSlots, realCandidate?.evaluatedFactSlots),
            },
            VARIANT_ACCURACY: {
                source: notMeasured('Variant-only outcomes are not reported as a separate numerator and denominator.'),
                realGemini: notMeasured('Variant-only outcomes are not reported as a separate numerator and denominator.'),
            },
            MULTI_TURN_CONTEXT_ACCURACY: {
                source: measuredRate(sourceCandidate?.contextResolutionVerifiedTurns, sourceCandidate?.contextDependentAnswerableTurns, sourceCandidate?.evaluatedContextDependentAnswerableTurns),
                realGemini: measuredRate(realCandidate?.contextResolutionVerifiedTurns, realCandidate?.contextDependentAnswerableTurns, realCandidate?.evaluatedContextDependentAnswerableTurns),
            },
            UNKNOWN_HANDLING_ACCURACY: {
                source: notMeasured('Unknown-answer cases do not have a separately reported accuracy denominator.'),
                realGemini: notMeasured('Unknown-answer cases do not have a separately reported accuracy denominator.'),
            },
            FALSE_REFUSAL_RATE: {
                source: measuredRate(sourceCandidate?.falseRefusalSlots, sourceCandidate?.eligibleFactSlots, sourceCandidate?.falseRefusalEvaluatedTurns),
                realGemini: measuredRate(realCandidate?.falseRefusalSlots, realCandidate?.eligibleFactSlots, realCandidate?.falseRefusalEvaluatedTurns),
                unit: 'eligible answerable fact slots; evaluated-turn coverage is reported separately',
            },
            UNSUPPORTED_CLAIM_RATE: {
                source: notMeasured('The general claim rate is not measured; only unsupported price claims with SEND disposition are checked.'),
                realGemini: notMeasured('The general claim rate is not measured; only unsupported price claims with SEND disposition are checked.'),
                unsupportedPriceClaims: {
                    source: measuredRate(sourceCandidate?.unsupportedClaimsSent, sourceCandidate?.routeExecutedTurns),
                    realGemini: measuredRate(realCandidate?.unsupportedClaimsSent, realCandidate?.routeExecutedTurns),
                },
            },
            SAFE_CROSS_DOMAIN_ROUTING_RATE: {
                source: measuredRate(sourceCandidate?.safeCrossDomainHandoffs, sourceCandidate?.crossDomainHandoffTurns, sourceCandidate?.evaluatedCrossDomainHandoffTurns),
                realGemini: measuredRate(realCandidate?.safeCrossDomainHandoffs, realCandidate?.crossDomainHandoffTurns, realCandidate?.evaluatedCrossDomainHandoffTurns),
            },
            GENUINE_IMAGE_MATCH_ACCURACY: {
                status: genuinePhotoQuality.status,
                photosTested: Number.isFinite(photosTested) ? photosTested : null,
                visibleCategory: measuredRate(photoCategoryMatches, photosTested),
                visibleColor: measuredRate(photoColorMatches, photosTested),
                catalogIdentity: measuredRate(
                    photos.filter(photo => photo.productCatalogIdentityScored === true && photo.catalogIdentityMatch === true).length,
                    photos.filter(photo => photo.productCatalogIdentityScored === true && typeof photo.catalogIdentityMatch === 'boolean').length,
                ),
                note: 'Visible category and color are supporting attributes, not catalog SKU identity accuracy.',
            },
            CUSTOMER_USEFULNESS_SCORE: {
                source: notMeasured('No blinded, separately configured semantic evaluator or usefulness score was recorded.'),
                realGemini: notMeasured('No blinded, separately configured semantic evaluator or usefulness score was recorded.'),
            },
        },
    };
    const realTextRequestAttempts = realComparison
        ? (realComparisonValid ? realComparison.results.reduce((sum, result) => sum + (result.summary?.textRequests || 0), 0) : campaignSummary.textRequestAttempts)
        : null;
    const realVisionRequestAttempts = realComparison
        ? (realComparisonValid ? realComparison.results.reduce((sum, result) => sum + (result.summary?.visionRequests || 0), 0) : campaignSummary.visionRequestAttempts)
        : null;
    const realTextProviderCalls = realComparison
        ? realComparisonValid && Number.isFinite(realBaselineRunLedgerSummary.providerTextCalls)
            && Number.isFinite(realRunLedgerSummary.providerTextCalls)
            ? realBaselineRunLedgerSummary.providerTextCalls + realRunLedgerSummary.providerTextCalls
            : campaignSummary.providerTextCalls
        : null;
    const realVisionProviderCalls = realComparison
        ? realComparisonValid && Number.isFinite(realBaselineRunLedgerSummary.providerVisionCalls)
            && Number.isFinite(realRunLedgerSummary.providerVisionCalls)
            ? realBaselineRunLedgerSummary.providerVisionCalls + realRunLedgerSummary.providerVisionCalls
            : campaignSummary.providerVisionCalls
        : null;
    const recordedComparisonSpend = realComparison ? realComparison.results.reduce((sum, result) => sum
        + (Number.isFinite(result.summary?.estimatedProviderChargeUsd) ? result.summary.estimatedProviderChargeUsd : 0), 0) : null;
    const realEstimatedSpend = realComparisonValid ? recordedComparisonSpend : null;
    const observedIncompleteSpend = realComparison && !realComparisonValid
        ? (Number.isFinite(campaign?.estimatedProviderChargeUsd) ? campaign.estimatedProviderChargeUsd : recordedComparisonSpend)
        : null;
    const campaignBudgetExhausted = campaign ? campaign.requestCount >= campaign.maxRequests
        || campaign.visionRequestCount >= campaign.maxVisionRequests
        || campaign.reservedWorstCaseUsd >= campaign.ceilingUsd : null;
    const sourceComparisonValid = sourceComparison?.comparisonValid === true;
    const heldoutComparisonValid = heldoutComparison?.comparisonValid === true;
    const integrationPass = integration ? integration.status === 'PASS' : null;
    const postgresPass = integrationPass === null ? null : integrationPass
        && integration?.migrations?.exitCode === 0
        && isIntegrationServiceReady(integration, 'postgres');
    const redisPass = integrationPass === null ? null : integrationPass
        && isIntegrationServiceReady(integration, 'redis');
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
    const playwrightAssessment = assessPlaywrightExecution(playwright);
    const privacyPass = privacyScanPassed(privacy);
    const backendSecurityStep = verificationReceipt?.steps?.find(step => step.name === 'backend-security-suite') || null;
    const integrationVerifierStep = verificationReceipt?.steps?.find(step => step.name === 'postgres-redis-worker-webhook-and-full-backend-regression') || null;
    const playwrightVerifierStep = verificationReceipt?.steps?.find(step => step.name === 'local-test-lab-playwright') || null;
    const privacyVerifierStep = verificationReceipt?.steps?.find(step => step.name === 'artifact-privacy-scan-and-checksum-manifest') || null;
    const backendSecurityPass = backendSecurityStep?.status === 'PASS';
    const securityPass = integration ? integration.egress?.guard === 'PASS' && backendSecurityPass : null;
    const realGeminiStatus = realComparison ? (realComparisonValid ? 'PASS' : 'FAIL') : 'NOT_RUN';
    const realGeminiCredentialStatus = !realComparison ? 'NOT_RUN'
        : campaignSummary.providerUsageRecords > 0 ? 'AUTHENTICATED' : 'NOT_MEASURED';
    const expectedCustomerDenominators = {
        sourceTurns: sourceOracle?.source?.turns,
        eligibleFactSlots,
        answerableProductTurns: textAnswerableTurns.length,
        falseRefusalExpectedTurns: textAnswerableTurns.length,
        contextDependentAnswerableTurns: sourceCandidate?.contextDependentAnswerableTurns,
        crossDomainHandoffTurns: sourceCandidate?.crossDomainHandoffTurns,
    };
    const sourceTruthQuality = assessRealGeminiQuality(sourceComparison, sourceCandidate, expectedCustomerDenominators);
    const realGeminiQuality = assessRealGeminiQuality(realComparison, realCandidate, expectedCustomerDenominators);
    const sourceTruthMetricsAvailable = Boolean(sourceComparisonValid && sourceCandidate);
    const visualAcceptanceComplete = visualCaseCoverage.representedCaseTypes === visualCaseCoverage.requiredCaseTypes
        && photos.length > 0 && photos.every(photo => photo.productCatalogIdentityScored === true);
    const unsupportedClaims = sourceCandidate?.unsupportedClaimsSent ?? null;
    const falseRefusals = sourceCandidate?.falseRefusalSlots ?? null;
    const contextFailures = sourceCandidate?.contextResolutionFailures ?? null;
    const unsafeCrossDomain = sourceCandidate?.unsafeCrossDomainHandoffs ?? null;
    const qualityPass = sourceTruthMetricsAvailable && sourceTruthQuality.status === 'PASS';
    // Bind an independent review to the code commit the verifier actually exercised.
    // Later evidence-only commits must not make that frozen code review appear stale.
    const independentStatus = independentVerificationStatus(
        independent, verificationReceipt?.candidateCommit || head, currentEngineHash, currentRunnerSourceSha256,
    );
    const independentPass = independentStatus === 'PASS';
    const automatedStepsPass = verificationReceipt?.status === 'PASS'
        && verificationReceipt?.complete === true
        && Array.isArray(verificationReceipt.steps)
        && verificationReceipt.steps.every(step => step.status === 'PASS' || step.status === 'NOT_RUN_OFFLINE_DEFAULT');
    const requiredEvidencePresent = sourceComparisonValid && heldoutComparisonValid && integrationPass && playwrightPass
        && securityPass && privacyPass && realGeminiStatus === 'PASS' && realGeminiQuality.status === 'PASS'
        && genuinePhotoQuality.status === 'PASS' && visualAcceptanceComplete
        && runnerProvenanceStatus === 'PASS' && independentPass;
    const hasNonTimeoutVerificationFailure = verificationReceipt?.steps?.some(step => step.status === 'FAIL' && !step.timedOut
        && !(step.name === 'local-test-lab-playwright' && playwrightAssessment === 'INCOMPLETE')) === true;
    const hasAutomatedFailure = hasNonTimeoutVerificationFailure || regression?.status === 'FAIL'
        || [sourceComparison, heldoutComparison, realComparison, integration, privacy]
            .some(item => (item && item.status === 'FAIL') || (item && item.comparisonValid === false))
        || playwrightAssessment === 'FAIL'
        || realGeminiQuality.status === 'FAIL'
        || genuinePhotoQuality.status === 'FAIL';
    const automatedQaVerdict = assessAutomatedQaVerdict({
        hasAutomatedFailure,
        sourceTruthMetricsAvailable,
        qualityPass,
        requiredEvidencePresent,
        automatedStepsPass,
        photoStatus: genuinePhotoQuality.status,
    });
    const integrationReady = automatedQaVerdict === 'PASS' && qualityPass && genuinePhotoQuality.status === 'PASS'
        && photoCategoryMatches === photosTested && photoColorMatches === photosTested && visualAcceptanceComplete;
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
        ...worktreeStatusFields(verificationReceipt, worktreeCleanAtProofGeneration),
        VERIFICATION_ENTRYPOINT_STATUS: verificationReceipt?.status || 'NOT_CAPTURED',
        VERIFICATION_ENTRYPOINT_COMPLETE: verificationReceipt?.complete === true ? 'YES' : 'NO',
        SOURCE_PERSONAS: sourceOracle?.source?.personas ?? 'UNKNOWN',
        SOURCE_TURNS: sourceOracle?.source?.turns ?? 'UNKNOWN',
        ELIGIBLE_PRODUCT_TURNS: sourceOracle ? textProductTurns.length : 'UNKNOWN',
        ANSWERABLE_PRODUCT_TURNS: sourceOracle ? textAnswerableTurns.length : 'UNKNOWN',
        VERIFIED_CORRECT_ANSWERS: sourceCandidate?.verifiedCorrectAnswers ?? 'NOT_RUN',
        INCORRECT_PRODUCT_ANSWERS: 'NOT_SEPARATELY_MEASURED',
        UNSUPPORTED_CLAIMS: unsupportedClaims ?? 'NOT_RUN',
        FALSE_REFUSALS: falseRefusals ?? 'NOT_RUN',
        FALSE_REFUSAL_TURNS_EXPECTED: sourceCandidate?.falseRefusalExpectedTurns ?? 'NOT_RUN',
        FALSE_REFUSAL_TURNS_EVALUATED: sourceCandidate?.falseRefusalEvaluatedTurns ?? 'NOT_RUN',
        FALSE_REFUSAL_TURNS_NOT_EVALUABLE: sourceCandidate?.falseRefusalNotEvaluableTurns ?? 'NOT_RUN',
        SOURCE_CONTEXT_FAILURES: contextFailures ?? 'NOT_RUN',
        REAL_GEMINI_CONTEXT_FAILURES: realCandidate?.contextResolutionFailures ?? 'NOT_RUN',
        REAL_GEMINI_CONTEXT_TURNS_EXPECTED: realCandidate?.contextDependentAnswerableTurns ?? 'NOT_RUN',
        REAL_GEMINI_CONTEXT_TURNS_EVALUATED: realCandidate?.evaluatedContextDependentAnswerableTurns ?? 'NOT_RUN',
        REAL_GEMINI_CONTEXT_TURNS_NOT_EVALUABLE: realCandidate?.contextResolutionNotEvaluableTurns ?? 'NOT_RUN',
        CROSS_DOMAIN_HANDOFFS_EXPECTED: realCandidate?.crossDomainHandoffTurns ?? 'NOT_RUN',
        CROSS_DOMAIN_HANDOFFS_EVALUATED: realCandidate?.evaluatedCrossDomainHandoffTurns ?? 'NOT_RUN',
        CROSS_DOMAIN_HANDOFFS_NOT_RUN: realCandidate?.crossDomainHandoffNotRunTurns ?? 'NOT_RUN',
        SOURCE_SAFE_CROSS_DOMAIN_HANDOFFS: sourceCandidate?.safeCrossDomainHandoffs ?? 'NOT_RUN',
        REAL_GEMINI_SAFE_CROSS_DOMAIN_HANDOFFS: realCandidate?.safeCrossDomainHandoffs ?? 'NOT_RUN',
        REAL_GEMINI_UNSAFE_CROSS_DOMAIN_HANDOFFS: realCandidate?.unsafeCrossDomainHandoffs ?? 'NOT_RUN',
        GENUINE_PHOTOS_TESTED: realComparison ? (realComparisonValid ? (photosTested ?? 'NOT_MEASURED') : 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_VISION_VERDICT: genuinePhotoQuality.status,
        REQUIRED_VISUAL_CASE_TYPES: visualCaseCoverage.requiredCaseTypes,
        REPRESENTED_VISUAL_CASE_TYPES: visualCaseCoverage.representedCaseTypes,
        REQUIRED_VISUAL_CASES_COMPLETE: visualAcceptanceComplete ? 'YES' : 'NO',
        GENUINE_IMAGE_CATALOG_IDENTITY_SCORED: photos.length > 0 && photos.every(photo =>
            photo.productCatalogIdentityScored === true && typeof photo.catalogIdentityMatch === 'boolean'
        ) ? 'YES' : 'NO',
        REAL_GEMINI_COMPARISON_VALID: realComparison ? (realComparisonValid ? 'YES' : 'NO') : 'NOT_RUN',
        REAL_GEMINI_CREDENTIAL_STATUS: realGeminiCredentialStatus,
        REAL_GEMINI_TEXT_REQUESTS: realComparisonValid ? (realTextProviderCalls ?? 'NOT_MEASURED') : realComparison ? 'NOT_MEASURED' : 'NOT_RUN',
        REAL_GEMINI_VISION_REQUESTS: realComparisonValid ? (realVisionProviderCalls ?? 'NOT_MEASURED') : realComparison ? 'NOT_MEASURED' : 'NOT_RUN',
        REAL_GEMINI_OBSERVED_TEXT_PROVIDER_CALLS: realComparison ? (realTextProviderCalls ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_OBSERVED_VISION_PROVIDER_CALLS: realComparison ? (realVisionProviderCalls ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_TEXT_REQUEST_ATTEMPTS: realComparison ? (realTextRequestAttempts ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_VISION_REQUEST_ATTEMPTS: realComparison ? (realVisionRequestAttempts ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_OBSERVED_REQUEST_ATTEMPTS: realComparison ? (campaignSummary.requestAttempts ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_OBSERVED_PROVIDER_USAGE_RECORDS: realComparison ? (campaignSummary.providerUsageRecords ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_CAMPAIGN_UNPRICED_OR_PENDING_REQUESTS: realComparison ? (campaignSummary.unpricedOrPendingRequests ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_ROUTE_EXECUTED_TURNS: realCandidate?.routeExecutedTurns ?? 'NOT_RUN',
        REAL_GEMINI_ROUTE_NOT_RUN_TURNS: realCandidate?.routeNotRunTurns ?? 'NOT_RUN',
        REAL_GEMINI_FALSE_REFUSAL_SLOTS: realCandidate?.falseRefusalSlots ?? 'NOT_RUN',
        REAL_GEMINI_PROVIDER_USAGE_RECORDS: realComparison ? (realCandidate?.providerUsageRecords ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_REQUEST_ATTEMPTS: realComparison ? (realCandidate?.requestAttempts ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_UNPRICED_PROVIDER_CALLS: realComparison ? (realCandidate?.unpricedProviderCalls ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_REJECTED_CAMPAIGN_ATTEMPTS: realComparison ? (realCandidate?.campaignRejectedAttempts ?? 'NOT_MEASURED') : 'NOT_RUN',
        REAL_GEMINI_FALSE_REFUSAL_TURNS_EXPECTED: realCandidate?.falseRefusalExpectedTurns ?? 'NOT_RUN',
        REAL_GEMINI_FALSE_REFUSAL_TURNS_EVALUATED: realCandidate?.falseRefusalEvaluatedTurns ?? 'NOT_RUN',
        REAL_GEMINI_FALSE_REFUSAL_TURNS_NOT_EVALUABLE: realCandidate?.falseRefusalNotEvaluableTurns ?? 'NOT_RUN',
        REAL_PROVIDER_ESTIMATED_COST_USD: !realComparison ? 'NOT_RUN' : realComparisonValid ? (realEstimatedSpend ?? 'NOT_MEASURED') : 'NOT_MEASURED',
        REAL_OBSERVED_PRICED_USAGE_ESTIMATE_USD: realComparison && !realComparisonValid
            ? (observedIncompleteSpend ?? 'NOT_MEASURED') : 'NOT_APPLICABLE',
        REAL_GEMINI_STATUS: realGeminiStatus,
        REAL_GEMINI_QUALITY_VERDICT: realGeminiQuality.status,
        REAL_GEMINI_RUNNER_PROVENANCE: runnerProvenanceStatus,
        SUPPLEMENTARY_GEMINI_PRO_DIAGNOSTIC_RUNS: supplementaryGeminiProPhotoSummary.runCount || 'NOT_RUN',
        SUPPLEMENTARY_GEMINI_PRO_REQUESTS: supplementaryGeminiProPhotoSummary.providerRequests ?? 'NOT_MEASURED',
        SUPPLEMENTARY_GEMINI_PRO_VISION_REQUESTS: supplementaryGeminiProPhotoSummary.visionRequests ?? 'NOT_MEASURED',
        SUPPLEMENTARY_GEMINI_PRO_ESTIMATED_COST_USD: supplementaryGeminiProPhotoSummary.estimatedProviderChargeUsd ?? 'NOT_MEASURED',
        SUPPLEMENTARY_GEMINI_PRO_WORST_CASE_RESERVED_USD: supplementaryGeminiProPhotoSummary.reservedWorstCaseUsd ?? 'NOT_MEASURED',
        SUPPLEMENTARY_GEMINI_PRO_CATEGORY_MATCH_OBSERVATIONS: supplementaryGeminiProPhotoSummary.categoryMatchesAcrossRepeatedObservations ?? 'NOT_MEASURED',
        SUPPLEMENTARY_GEMINI_PRO_COLOR_MATCH_OBSERVATIONS: supplementaryGeminiProPhotoSummary.colorMatchesAcrossRepeatedObservations ?? 'NOT_MEASURED',
        GEMINI_LITE_PHOTO_FOLLOW_UP_RUN: currentBoundGeminiLitePhotoRun?.runId || 'NOT_RUN',
        GEMINI_LITE_PHOTO_FOLLOW_UP_CODE_BINDING: currentBoundGeminiLitePhotoRun?.currentCodeBinding
            || supplementaryGeminiLitePhotoRuns.at(-1)?.currentCodeBinding || 'NOT_RUN',
        GEMINI_LITE_PHOTO_FOLLOW_UP_REQUESTS: currentBoundGeminiLitePhotoRun?.providerRequests ?? 'NOT_MEASURED',
        GEMINI_LITE_PHOTO_FOLLOW_UP_VISION_REQUESTS: currentBoundGeminiLitePhotoRun?.visionRequests ?? 'NOT_MEASURED',
        GEMINI_LITE_PHOTO_FOLLOW_UP_COST_USD: currentBoundGeminiLitePhotoRun?.estimatedProviderChargeUsd ?? 'NOT_MEASURED',
        GEMINI_LITE_PHOTO_FOLLOW_UP_RESERVED_USD: currentBoundGeminiLitePhotoRun?.reservedWorstCaseUsd ?? 'NOT_MEASURED',
        GEMINI_LITE_PHOTO_FOLLOW_UP_IDENTITY_SCORED: currentBoundGeminiLitePhotoRun?.identityScored === true ? 'YES' : 'NO',
        REAL_GEMINI_HELDOUT_EVALUATION: 'NOT_RUN',
        CUSTOMER_USEFULNESS_SCORE: 'NOT_MEASURED',
        V13_DISTINCT_CAMPAIGN_LEDGER_COUNT: aggregateBudgetReconciliation.distinctCampaignCount,
        V13_AGGREGATE_CAMPAIGN_REQUESTS: aggregateBudgetReconciliation.requestCount ?? 'NOT_MEASURED',
        V13_AGGREGATE_CAMPAIGN_VISION_REQUESTS: aggregateBudgetReconciliation.visionRequestCount ?? 'NOT_MEASURED',
        V13_AGGREGATE_UNKNOWN_USAGE_REQUESTS: aggregateBudgetReconciliation.unknownUsageRequestCount ?? 'NOT_MEASURED',
        V13_AGGREGATE_ESTIMATED_COST_USD: aggregateBudgetReconciliation.estimatedProviderChargeUsd ?? 'NOT_MEASURED',
        V13_AGGREGATE_WORST_CASE_RESERVED_USD: aggregateBudgetReconciliation.reservedWorstCaseUsd ?? 'NOT_MEASURED',
        V13_SUM_OF_CAMPAIGN_CEILINGS_USD: aggregateBudgetReconciliation.sumOfPerCampaignCeilingsUsd ?? 'NOT_MEASURED',
        V12_CONSERVATIVE_TASK_SERIES_EXPOSURE_USD: aggregateBudgetReconciliation.v1_2ConservativeTaskSeriesExposureUsd ?? 'NOT_MEASURED',
        AUTHORIZED_AGGREGATE_BUDGET_USD: aggregateBudgetReconciliation.authorizedAggregateBudgetUsd,
        COMBINED_RESERVED_EXPOSURE_USD: aggregateBudgetReconciliation.combinedReservedExposureUsd ?? 'NOT_MEASURED',
        REMAINING_AGGREGATE_AUTHORIZATION_USD: aggregateBudgetReconciliation.remainingAggregateAuthorizationUsd ?? 'NOT_MEASURED',
        AGGREGATE_BUDGET_RECONCILIATION: aggregateBudgetReconciliation.status,
        PROVIDER_BUDGET_EXHAUSTED: campaignBudgetExhausted === null ? 'UNKNOWN' : campaignBudgetExhausted ? 'YES' : 'NO',
        POSTGRES_INTEGRATION: integration ? passState(postgresPass) : verificationStepState(integrationVerifierStep),
        REDIS_INTEGRATION: integration ? passState(redisPass) : verificationStepState(integrationVerifierStep),
        MESSAGE_WORKER_INTEGRATION: integration ? passState(workerPass) : verificationStepState(integrationVerifierStep),
        WEBHOOK_PIPELINE: integration ? passState(webhookPass) : verificationStepState(integrationVerifierStep),
        PRODUCT_SEARCH_INTEGRATION: integration ? passState(productSearchPass) : verificationStepState(integrationVerifierStep),
        FAKE_META_TRANSPORT: integration ? passState(fakeMetaPass) : verificationStepState(integrationVerifierStep),
        BACKEND_REGRESSION: backendRegressionPass ? 'PASS' : integration?.jest?.backendRegression
            ? (integration.jest.backendRegression.timedOut ? 'TIMED_OUT' : 'FAIL')
            : verificationStepState(integrationVerifierStep),
        PLAYWRIGHT_E2E: playwright ? playwrightAssessment : verificationStepState(playwrightVerifierStep),
        SECURITY_TESTS: backendSecurityPass ? 'PASS' : backendSecurityStep?.timedOut ? 'TIMED_OUT'
            : backendSecurityStep ? 'FAIL' : 'NOT_RUN',
        PRIVACY_SCAN: privacyPass ? 'PASS' : privacy ? 'FAIL' : verificationStepState(privacyVerifierStep),
        INDEPENDENT_VERIFICATION: independentStatus,
        BASELINE_COMPARISON_VALID: sourceComparisonValid ? 'YES' : sourceComparison ? 'NO' : 'NOT_RUN',
        DETERMINISTIC_SOURCE_TRUTH_VERDICT: sourceTruthMetricsAvailable ? (qualityPass ? 'PASS' : 'FAIL') : 'NOT_RUN',
        CUSTOMER_TRUTH_VERDICT: sourceTruthMetricsAvailable ? (qualityPass ? 'PASS' : 'FAIL') : 'NOT_RUN',
        CUSTOMER_TRUTH_VERDICT_SCOPE: 'DETERMINISTIC_SOURCE_REPLAY_ONLY',
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
            quality: sourceTruthQuality,
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
            quality: realGeminiQuality,
            runnerProvenance: {
                status: runnerProvenanceStatus,
                paidCandidateRunnerSha256: paidRunnerSourceSha256,
                currentRunnerSha256: currentRunnerSourceSha256,
                matchesCurrent: runnerProvenanceStatus === 'PASS',
            },
            model: realComparison.model,
            credentialStatus: realGeminiCredentialStatus,
            baseline: realBaseline,
            candidate: realCandidate,
            metricOutcomes: realComparison.metricOutcomes || {},
            textRequestAttemptsBothEngines: realTextRequestAttempts,
            visionRequestAttemptsBothEngines: realVisionRequestAttempts,
            providerTextCallsBothEngines: realTextProviderCalls,
            providerVisionCallsBothEngines: realVisionProviderCalls,
            campaignLedger: campaignSummary,
            comparisonCompleted: realComparisonValid,
            estimatedProviderChargeUsdBothEngines: realComparisonValid ? realEstimatedSpend : null,
            observedPricedProviderChargeUsdAcrossIncompleteAttempts: observedIncompleteSpend,
            candidateProviderUsageRecords: realCandidate?.providerUsageRecords ?? null,
            candidateRequestAttempts: realCandidate?.requestAttempts ?? null,
            candidateUnpricedProviderCalls: realCandidate?.unpricedProviderCalls ?? null,
            candidateRejectedAttempts: realCandidate?.campaignRejectedAttempts ?? null,
            candidate: realCandidate,
            photoEvaluationStatus: realComparisonValid ? 'COMPLETE' : realComparison ? 'INCOMPLETE_NO_VALID_MATCHED_COMPARISON' : 'NOT_RUN',
            photosTested: photosTested,
            photoCategoryMatches,
            photoColorMatches,
            photoCases: photos.map(photo => ({
                fixtureId: photo.fixtureId,
                fixtureSha256: photo.fixtureSha256,
                status: photo.status,
                productionObservationParsed: photo.productionObservationParsed === true,
                labelPresenceProxy: photo.labelPresenceProxy === true,
                observedCategory: photo.observedCategory,
                providerResponseRedacted: typeof photo.providerResponseRedacted === 'string' ? photo.providerResponseRedacted : null,
                categoryMatch: photo.categoryMatch,
                observedDominantColor: photo.observedDominantColor,
                dominantColorMatch: photo.dominantColorMatch,
                unverifiedMaterialFieldPopulated: photo.unverifiedMaterialFieldPopulated,
                productCatalogIdentityScored: photo.productCatalogIdentityScored === true,
                catalogIdentityMatch: typeof photo.catalogIdentityMatch === 'boolean' ? photo.catalogIdentityMatch : null,
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
            evidenceRoot: ARTIFACT_ROOT,
            backendSourceSha256: currentEngineHash,
            currentRunnerSourceSha256,
            baselineSha: BASELINE_SHA,
            cleanAtVerificationStart: worktreeStatusFields(verificationReceipt, worktreeCleanAtProofGeneration)
                .WORKTREE_CLEAN_AT_VERIFICATION_START,
            cleanWhenProofGenerated: worktreeCleanAtProofGeneration,
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
        customerQualityMetricAudit,
        visualCaseCoverage,
        comparisons: comparisonDetails,
        supplementaryGeminiProPhotoDiagnostics: {
            summary: supplementaryGeminiProPhotoSummary,
            runs: supplementaryGeminiProPhotoRuns,
        },
        supplementaryGeminiLitePhotoDiagnostics: {
            currentCodeBoundRunId: currentBoundGeminiLitePhotoRun?.runId || null,
            runs: supplementaryGeminiLitePhotoRuns,
        },
        budgetReconciliation: aggregateBudgetReconciliation,
        measured: {
            verifiedCorrectAnswers: sourceCandidate?.verifiedCorrectAnswers ?? null,
            verifiedCorrectTurns: sourceCandidate?.verifiedCorrectTurns ?? null,
            falseRefusalSlots: falseRefusals,
            falseRefusalExpectedTurns: sourceCandidate?.falseRefusalExpectedTurns ?? null,
            falseRefusalEvaluatedTurns: sourceCandidate?.falseRefusalEvaluatedTurns ?? null,
            falseRefusalNotEvaluableTurns: sourceCandidate?.falseRefusalNotEvaluableTurns ?? null,
            unsupportedPriceClaimsSent: unsupportedClaims,
            contextResolutionFailures: contextFailures,
            contextDependentAnswerableTurns: sourceCandidate?.contextDependentAnswerableTurns ?? null,
            evaluatedContextDependentAnswerableTurns: sourceCandidate?.evaluatedContextDependentAnswerableTurns ?? null,
            contextResolutionNotEvaluableTurns: sourceCandidate?.contextResolutionNotEvaluableTurns ?? null,
            safeCrossDomainHandoffs: sourceCandidate?.safeCrossDomainHandoffs ?? null,
            unsafeCrossDomainHandoffs: unsafeCrossDomain,
            crossDomainHandoffTurns: sourceCandidate?.crossDomainHandoffTurns ?? null,
            evaluatedCrossDomainHandoffTurns: sourceCandidate?.evaluatedCrossDomainHandoffTurns ?? null,
            crossDomainHandoffNotRunTurns: sourceCandidate?.crossDomainHandoffNotRunTurns ?? null,
            incorrectOrUnansweredFactSlots: totalIncorrectOrUnansweredSlots,
            incorrectProductAnswersSeparatelyMeasured: false,
            candidateP50RouteMs: sourceCandidate?.p50RouteMs ?? null,
            candidateP95RouteMs: sourceCandidate?.p95RouteMs ?? null,
            measuredLatencyLayer: 'in-process router comparison; not end-to-end merchant latency',
            estimatedProviderChargeUsd: realComparisonValid ? realEstimatedSpend : null,
            observedPricedProviderChargeUsdAcrossIncompleteAttempts: observedIncompleteSpend,
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
                unpricedRequestCount: campaign.unpricedRequestCount ?? null,
                providerInvoice: campaign.providerInvoice || 'NOT_AVAILABLE',
                summary: campaignSummary,
            } : null,
            ...calculateCandidateCostMetrics(realComparisonValid, realCandidate),
            incorrectOrUnansweredSlotDefinition: 'Answerable fact slots not answered with the expected value; includes partial answers and false refusals.',
        },
        integration: {
            status: integration?.status || verificationStepState(integrationVerifierStep),
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
        requiredQualityMetricAudit: customerQualityMetricAudit,
        genuinePhotoCaseCoverage: visualCaseCoverage,
        browser: playwright ? { ...playwright, rawStatus: playwright.status, status: playwrightAssessment } : {
            status: verificationStepState(playwrightVerifierStep),
            outerVerificationStep: playwrightVerifierStep,
        },
        security: {
            status: securityPass === true ? 'PASS' : securityPass === false ? 'FAIL'
                : backendSecurityStep?.timedOut || integrationVerifierStep?.timedOut ? 'TIMED_OUT'
                    : backendSecurityStep?.status === 'PASS' ? 'INCOMPLETE'
                        : backendSecurityStep ? 'FAIL' : 'NOT_RUN',
            egress: integration?.egress || null,
            backendSecuritySuite: backendSecurityStep,
            integrationVerifierStep: integrationVerifierStep,
            privacyScan: privacy || null,
        },
        independentVerification: independent || { verdict: 'NOT_RUN', note: 'A separate read-only reviewer has not yet recorded a result.' },
        verificationEntryPoint: verificationReceipt ? {
            status: verificationReceipt.status,
            runId: verificationReceipt.runId,
            mode: verificationReceipt.mode,
            complete: verificationReceipt.complete ?? false,
            receiptPath: verificationReceiptPath,
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
        realComparison, realBaseline, realCandidate, realGeminiQuality, genuinePhotoQuality,
        customerQualityMetricAudit, visualCaseCoverage,
        photosTested, photoCategoryMatches, photoColorMatches,
        photoIdentityScored: photos.length > 0 && photos.every(photo =>
            photo.productCatalogIdentityScored === true && typeof photo.catalogIdentityMatch === 'boolean'
        ),
        integration, integrationVerifierStep, playwright, playwrightAssessment, playwrightVerifierStep, privacy, independent, backendRegressionTests, selectedIntegrationTests, webhookTests,
        totalIncorrectOrUnansweredSlots, campaign, campaignSummary, automatedQaVerdict, integrationReady,
        supplementaryGeminiProPhotoRuns, supplementaryGeminiProPhotoSummary,
        supplementaryGeminiLitePhotoRuns, currentBoundGeminiLitePhotoRun, aggregateBudgetReconciliation,
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
        realGeminiQualityStatus: realGeminiQuality.status,
        runnerProvenanceStatus,
        integrationReady: integrationReady ? 'YES' : 'NO',
        automatedQaVerdict,
        sourcePersonas: machineStatus.SOURCE_PERSONAS,
        sourceTurns: machineStatus.SOURCE_TURNS,
        answerableProductTurns: machineStatus.ANSWERABLE_PRODUCT_TURNS,
        verifiedCorrectAnswers: machineStatus.VERIFIED_CORRECT_ANSWERS,
    }) + '\n');
    if (automatedQaVerdict === 'FAIL') process.exitCode = 1;
};

function summarizeRunLedger(ledger) {
    const calls = ledger?.snapshot?.calls;
    if (!Array.isArray(calls)) return {
        providerUsageRecords: null,
        requestAttempts: null,
        providerTextCalls: null,
        providerVisionCalls: null,
        textRequestAttempts: null,
        visionRequestAttempts: null,
        unpricedProviderCalls: null,
        campaignRejectedAttempts: null,
    };
    const providerReported = calls.filter(call => call?.status === 'provider_reported');
    const campaignRejected = calls.filter(call => call?.status === 'campaign_ledger_rejected');
    const providerTextCalls = providerReported.filter(call => call.vision !== true).length;
    const providerVisionCalls = providerReported.filter(call => call.vision === true).length;
    const rejectedTextAttempts = campaignRejected.filter(call => call.vision !== true).length;
    const rejectedVisionAttempts = campaignRejected.filter(call => call.vision === true).length;
    return {
        providerUsageRecords: providerReported.length,
        requestAttempts: providerReported.length + campaignRejected.length,
        providerTextCalls,
        providerVisionCalls,
        textRequestAttempts: providerTextCalls + rejectedTextAttempts,
        visionRequestAttempts: providerVisionCalls + rejectedVisionAttempts,
        unpricedProviderCalls: providerReported.filter(call => !Number.isFinite(call.estimatedProviderChargeUsd)).length,
        campaignRejectedAttempts: campaignRejected.length,
    };
}

function summarizeCampaignLedger(ledger) {
    const calls = ledger?.calls;
    if (!Array.isArray(calls)) return {
        requestAttempts: null,
        providerUsageRecords: null,
        providerTextCalls: null,
        providerVisionCalls: null,
        textRequestAttempts: null,
        visionRequestAttempts: null,
        unpricedOrPendingRequests: null,
        baselineAttempts: null,
        candidateAttempts: null,
    };
    const providerReported = calls.filter(call => call.status === 'provider_reported');
    const baselineAttempts = calls.filter(call => String(call.stage || '').startsWith('baseline-v1-2-source-real-gemini-')).length;
    const candidateAttempts = calls.filter(call => String(call.stage || '').startsWith('candidate-v1-3-source-real-gemini-')).length;
    return {
        requestAttempts: calls.length,
        providerUsageRecords: providerReported.length,
        providerTextCalls: providerReported.filter(call => call.vision !== true).length,
        providerVisionCalls: providerReported.filter(call => call.vision === true).length,
        textRequestAttempts: calls.filter(call => call.vision !== true).length,
        visionRequestAttempts: calls.filter(call => call.vision === true).length,
        unpricedOrPendingRequests: Number.isFinite(ledger.unpricedRequestCount)
            ? ledger.unpricedRequestCount : calls.filter(call => call.status !== 'provider_reported').length,
        baselineAttempts,
        candidateAttempts,
    };
}

function calculateCandidateCostMetrics(realComparison, realCandidate) {
    const usageFullyPriced = realCandidate?.unpricedProviderCalls === 0;
    const estimatedProviderChargeUsd = realComparison && usageFullyPriced && Number.isFinite(realCandidate?.estimatedProviderChargeUsd)
        ? realCandidate.estimatedProviderChargeUsd : null;
    return {
        estimatedCostPerCandidateVerifiedAnswerUsd: estimatedProviderChargeUsd !== null
            && Number.isFinite(realCandidate?.verifiedCorrectTurns) && realCandidate.verifiedCorrectTurns > 0
            ? estimatedProviderChargeUsd / realCandidate.verifiedCorrectTurns : null,
        estimatedCostPerCandidateVerifiedFactSlotUsd: estimatedProviderChargeUsd !== null
            && Number.isFinite(realCandidate?.verifiedCorrectAnswers) && realCandidate.verifiedCorrectAnswers > 0
            ? estimatedProviderChargeUsd / realCandidate.verifiedCorrectAnswers : null,
    };
}

function renderMarkdown(proof, status, examples, comparisons, details) {
    const metricTable = Object.entries(status).map(([key, value]) => `| \`${key}\` | ${String(value)} |`).join('\n');
    const exampleText = examples.length ? examples.map(example => [
        `### ${example.label} — ${example.scenarioId}`,
        `Customer message (redacted): ${example.customerMessageRedacted || '[empty]'}`,
        `Engine response (redacted): ${example.engineResponseRedacted || '[empty]'}`,
        `Disposition: ${example.disposition}; correct answer slots: ${example.correctAnsweredSlots ?? 'NOT_MEASURED'}/${example.eligibleSlots ?? 'NOT_MEASURED'}.`,
    ].join('\n\n')).join('\n\n') : 'No current, provenance-matched source comparison is available.';
    const customerMetricAudit = details.customerQualityMetricAudit || { metrics: {}, uncertainty: 'NOT_RECORDED' };
    const metricDisplay = value => {
        if (Number.isFinite(value?.numerator) && Number.isFinite(value?.denominator)) {
            const percentage = Number.isFinite(value.rate) ? ' (' + (value.rate * 100).toFixed(1) + '%)' : '';
            const evaluated = Number.isFinite(value.evaluated) ? '; evaluated ' + value.evaluated : '';
            return value.numerator + '/' + value.denominator + percentage + evaluated;
        }
        return value?.status || 'NOT_MEASURED';
    };
    const qualityMetricRows = Object.entries(customerMetricAudit.metrics || {}).map(([name, metric]) => {
        let deterministic = metricDisplay(metric.source);
        let paid = metricDisplay(metric.realGemini);
        let note = metric.unit || metric.note || metric.source?.note || metric.realGemini?.note || '';
        if (name === 'UNSUPPORTED_CLAIM_RATE' && metric.unsupportedPriceClaims) {
            note = 'General claim rate not measured. Unsupported price claims with SEND: '
                + metricDisplay(metric.unsupportedPriceClaims.source) + ' deterministic; '
                + metricDisplay(metric.unsupportedPriceClaims.realGemini) + ' paid.';
        }
        if (name === 'GENUINE_IMAGE_MATCH_ACCURACY') {
            deterministic = 'NOT_APPLICABLE';
            paid = (metric.status || 'NOT_MEASURED') + '; visible category '
                + metricDisplay(metric.visibleCategory) + '; visible color ' + metricDisplay(metric.visibleColor)
                + '; catalog SKU identity ' + metricDisplay(metric.catalogIdentity);
            note = metric.note || 'Catalog identity not scored.';
        }
        return '| ' + name + ' | ' + deterministic + ' | ' + paid + ' | ' + note + ' |';
    });
    const qualityMetricAuditBlock = [
        '### Required automated quality metric coverage',
        '',
        '| Metric | Deterministic source candidate | Paid Gemini candidate | Scope / limitation |',
        '|---|---|---|---|',
        ...qualityMetricRows,
        '',
        customerMetricAudit.uncertainty || 'Sample uncertainty: NOT_RECORDED.',
    ].join('\n');
    const sourceLine = details.sourceOracle
        ? `${details.sourceOracle.source.personas} personas, ${details.sourceOracle.source.turns} turns, ${status.ELIGIBLE_PRODUCT_TURNS} text product turns, ${status.ANSWERABLE_PRODUCT_TURNS} answerable turns, and ${proof.benchmark.eligibleFactSlots} answerable fact slots.`
        : 'Source oracle is not available.';
    const sourceComparisonBlock = details.sourceComparison
        ? `Valid: **${details.sourceComparison.comparisonValid ? 'YES' : 'NO'}**. V1.2 verified answers: ${details.sourceBaseline?.verifiedCorrectAnswers ?? 'NOT_RUN'}; V1.3 verified answers: ${details.sourceCandidate?.verifiedCorrectAnswers ?? 'NOT_RUN'}. V1.2 context failures: ${details.sourceBaseline?.contextResolutionFailures ?? 'NOT_RUN'}; V1.3: ${details.sourceCandidate?.contextResolutionFailures ?? 'NOT_RUN'} across ${details.sourceCandidate?.evaluatedContextDependentAnswerableTurns ?? 'NOT_RUN'}/${details.sourceCandidate?.contextDependentAnswerableTurns ?? 'NOT_RUN'} complete conversation chains. V1.3 context turns not evaluable: ${details.sourceCandidate?.contextResolutionNotEvaluableTurns ?? 'NOT_RUN'}.`
        : 'No valid source comparison is available.';
    const heldoutBlock = details.heldoutComparison
        ? `Valid: **${details.heldoutComparison.comparisonValid ? 'YES' : 'NO'}**. V1.2 verified answers: ${details.heldoutBaseline?.verifiedCorrectAnswers ?? 'NOT_RUN'}; V1.3 verified answers: ${details.heldoutCandidate?.verifiedCorrectAnswers ?? 'NOT_RUN'}.`
        : 'No held-out comparison is available.';
    const imageBlock = details.realComparison?.comparisonValid === true
        ? 'Photo acceptance verdict: **' + (details.genuinePhotoQuality?.status || status.REAL_GEMINI_VISION_VERDICT || 'NOT_MEASURED') + '**. '
            + (details.currentBoundGeminiLitePhotoRun
                ? 'The current-code-bound Gemini Lite follow-up ' + details.currentBoundGeminiLitePhotoRun.runId + ' evaluated '
                : 'The matched paid Gemini run evaluated ')
            + (details.photosTested ?? 'NOT_MEASURED') + ' licensed public photos. Category matches: '
            + details.photoCategoryMatches + '/' + (details.photosTested ?? 'NOT_MEASURED')
            + '; visible-color matches: ' + details.photoColorMatches + '/' + (details.photosTested ?? 'NOT_MEASURED')
            + '; catalog identity: ' + (details.photoIdentityScored ? 'SCORED' : 'NOT SCORED')
            + '. The matched comparison originally reported 0/3 categories with the slash-rejecting scorer; the follow-up stores the actual redacted provider outputs. The fixtures represent only 1 of the 15 required visual case types (one clean, single-product photograph); the other 14 case types are not covered. No catalog SKU identity score exists. These public-photo results are not customer-upload accuracy evidence.'
        : details.realComparison
            ? `Photo acceptance verdict: **${details.genuinePhotoQuality?.status || 'NOT_MEASURED'}**. No completed true-photo comparison is available. The Gemini comparison was incomplete, so photo accuracy is NOT_MEASURED.`
            : 'Real Gemini vision evaluation: NOT_RUN.';
    const supplementaryProRuns = details.supplementaryGeminiProPhotoRuns || [];
    const supplementaryProSummary = details.supplementaryGeminiProPhotoSummary || {};
    const supplementaryLitePhotoRuns = details.supplementaryGeminiLitePhotoRuns || [];
    const supplementaryProBlock = supplementaryProRuns.length ? [
        '### Supplementary Gemini Pro photo diagnostics — evaluation only',
        '',
        `Three separate Pro-only campaigns made ${supplementaryProSummary.providerRequests ?? 'NOT_MEASURED'} vision requests. Combined token-priced estimate: $${Number(supplementaryProSummary.estimatedProviderChargeUsd || 0).toFixed(6)}; combined worst-case reservation: $${Number(supplementaryProSummary.reservedWorstCaseUsd || 0).toFixed(6)} under $${Number(supplementaryProSummary.campaignCeilingsUsd || 0).toFixed(2)} in per-campaign ceilings. The runs repeat the same three licensed public photos; the 9 observations are not 9 independent images. Invoice: NOT_AVAILABLE.`,
        '',
        '| Run | Thinking | Output cap | Category | Color | Finish reasons | Estimate / reserved (campaign cap) | Provenance |',
        '|---|---|---:|---:|---:|---|---|---|',
        ...supplementaryProRuns.map(run => {
            const cap = run.effectiveMaxOutputTokens ?? run.configuredRouteMaxOutputTokens ?? 'NOT_CAPTURED';
            const finishReasons = [...new Set((run.cases || []).map(item => item.finishReason).filter(Boolean))];
            const finish = finishReasons.length ? finishReasons.join(', ') : 'NOT_RECORDED';
            const estimate = Number.isFinite(run.estimatedProviderChargeUsd) ? `$${run.estimatedProviderChargeUsd.toFixed(6)}` : 'NOT_MEASURED';
            const reserved = Number.isFinite(run.reservedWorstCaseUsd) ? `$${run.reservedWorstCaseUsd.toFixed(6)}` : 'NOT_MEASURED';
            const ceiling = Number.isFinite(run.campaignCeilingUsd) ? `$${run.campaignCeilingUsd.toFixed(2)}` : 'NOT_MEASURED';
            const provenance = run.transportProvenance?.status === 'INCOMPLETE_CALL_TIME_SOURCE_BINDING'
                ? 'PARTIAL; runner hash omitted diagnostic transport'
                : 'runner hash recorded';
            return `| ${run.runId} | ${run.thinkingLevel} | ${cap} | ${run.categoryMatches ?? 'NOT_MEASURED'}/${run.photosTested ?? 'NOT_MEASURED'} | ${run.colorMatches ?? 'NOT_MEASURED'}/${run.photosTested ?? 'NOT_MEASURED'} | ${finish} | ${estimate} / ${reserved} (${ceiling}) | ${provenance} |`;
        }),
        '',
        ...supplementaryProRuns.filter(run => run.experiment === 'bounded-gemini-pro-production-photo-extraction-low-thinking').map(run => {
            const categoryLabels = (run.cases || []).map(item => item.observedCategory || 'null').join(', ');
            const colorLabels = (run.cases || []).map(item => item.observedDominantColor || 'null').join(', ');
            const candidateTokens = (run.calls || []).map(call => call.candidateTokens).filter(Number.isFinite);
            const tokenText = candidateTokens.length ? `${candidateTokens.join('/')} candidate tokens` : 'candidate token counts NOT_MEASURED';
            const materialClaims = (run.cases || []).filter(item => item.unverifiedMaterialFieldPopulated === true).length;
            return `The low-thinking run ${run.runId} returned category labels ${categoryLabels} and colors ${colorLabels} (${tokenText}); every case finished with STOP. It matched category on ${run.categoryMatches}/${run.photosTested} and visible color on ${run.colorMatches}/${run.photosTested}; unverified material fields populated: ${materialClaims}. The receipt's labelPresenceProxy means at least one safe field reached the scorer; it is not full JSON-schema validation. Because raw provider text was not retained, this confirms a repeated category-field failure but cannot distinguish model output from parser or safe-label rejection. The recorded runner hash omitted the dedicated transport file. This receipt is therefore not fully code-attested; the manifest correction applies to future runs and does not retroactively bind this provider request.`;
        }),
    ].join('\n') : 'Supplementary Gemini Pro photo diagnostics: NOT_RUN.';
    const currentBoundGeminiLitePhotoRun = details.currentBoundGeminiLitePhotoRun || null;
    const safeInlineMarkdown = value => String(value || 'NOT_RECORDED').replace(/\s+/g, ' ').replace(/[&<>`|]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '`': '&#96;', '|': '&#124;',
    })[character]);
    const supplementaryLitePhotoBlock = currentBoundGeminiLitePhotoRun ? [
        '### Code-bound Gemini Lite photo follow-up after scorer correction',
        '',
        'Run ' + currentBoundGeminiLitePhotoRun.runId + '; model ' + currentBoundGeminiLitePhotoRun.model + '; '
            + currentBoundGeminiLitePhotoRun.providerRequests + ' requests, ' + currentBoundGeminiLitePhotoRun.visionRequests
            + ' vision requests; estimated token cost $' + Number(currentBoundGeminiLitePhotoRun.estimatedProviderChargeUsd || 0).toFixed(8)
            + '; reserved $' + Number(currentBoundGeminiLitePhotoRun.reservedWorstCaseUsd || 0).toFixed(8)
            + ' under a $' + Number(currentBoundGeminiLitePhotoRun.campaignCeilingUsd || 0).toFixed(2) + ' campaign cap. Catalog SKU identity: NOT SCORED.',
        '',
        ...currentBoundGeminiLitePhotoRun.cases.map(item => {
            const response = safeInlineMarkdown(item.providerResponseRedacted).slice(0, 700);
            const reply = safeInlineMarkdown(item.customerFacingReplyRedacted).slice(0, 500);
            return '- ' + item.fixtureId + ': provider output ' + response + '; parsed category=' + (item.observedCategory || 'null')
                + ', visible color=' + (item.observedDominantColor || 'null') + ', category match=' + item.categoryMatch
                + ', color match=' + item.dominantColorMatch + ', route latency=' + (item.routeLatencyMs ?? 'NOT_MEASURED')
                + ' ms, provider latency=' + (item.providerLatencyMs ?? 'NOT_MEASURED')
                + ' ms, estimated call cost=$' + Number(item.estimatedProviderChargeUsd || 0).toFixed(8)
                + '; customer reply ' + reply + '.';
        }),
    ].join('\n') : supplementaryLitePhotoRuns.length
        ? 'A Gemini Lite photo diagnostic exists, but it is not bound to the current code, engine-source and runner hashes; it is excluded from the current gate.'
        : 'Corrected-scorer Gemini Lite photo follow-up: NOT_RUN.';
    const visualCaseCoverageBlock = [
        '### Required visual scenario coverage',
        '',
        `Represented case types: ${details.visualCaseCoverage?.representedCaseTypes ?? 0}/${details.visualCaseCoverage?.requiredCaseTypes ?? REQUIRED_VISUAL_CASES.length}. A case counts as represented only when its fixture has the requested visual condition; repeated photos or repeated model calls do not add case types.`,
        '',
        '| Required case | Coverage | Fixture |',
        '|---|---|---|',
        ...(details.visualCaseCoverage?.cases || summarizeRequiredVisualCaseCoverage([]).cases)
            .map(item => `| ${item.name} | ${item.status} | ${(item.fixtureIds || []).join(', ') || '—'} |`),
        '',
        'Required output coverage is partial: the run records fixture provenance/checksum, visible category/color, redacted provider output, redacted customer response, latency, estimated token cost, and an unverified-material flag. It does not record independently known catalog SKU identity, retrieved catalog candidates, a final SKU match, calibrated confidence/ambiguity, or a complete per-attribute reliability annotation. Catalog product identity accuracy is therefore NOT_MEASURED.',
    ].join('\n');
    const integrationServiceDescription = details.integration?.serviceMode?.provider === 'user-provisioned-wsl-loopback'
        ? `user-provisioned WSL PostgreSQL ${safeText(details.integration.services?.find(service => service.name === 'postgres')?.version || 'version not recorded')} and Redis ${safeText(details.integration.services?.find(service => service.name === 'redis')?.version || 'version not recorded')} on 127.0.0.1; read-only protocol checks passed before migrations`
        : 'a disposable project-scoped Docker Compose stack';
    const integrationBlock = details.integration?.jest?.selectedIntegration || details.integration?.jest?.webhookPipelineE2E || details.integration?.jest?.backendRegression
        ? `Receipt status: **${details.integration.status}**; PostgreSQL and Redis use ${integrationServiceDescription}. Selected integration: ${details.selectedIntegrationTests}; webhook pipeline: ${details.webhookTests}; full backend regression: ${details.backendRegressionTests}. Receipts: \`${proof.candidate.evidenceRoot}\\integration\`.`
        : details.integrationVerifierStep
            ? `Outer integration verification ${details.integrationVerifierStep.timedOut ? 'timed out' : 'did not produce an inner receipt'}; no inner integration receipt was written, so individual integration assertions are NOT_MEASURED. Runner status: ${verificationStepState(details.integrationVerifierStep)}; subprocess cleanup: ${details.integrationVerifierStep.timeoutCleanup || 'NOT_RECORDED'}.`
            : 'Local integration: NOT_RUN.';
    const browserBlock = details.playwrightAssessment === 'INCOMPLETE'
        ? `Playwright process exited with code ${details.playwright?.playwrightExitCode}; its report contains no completed browser journey, so browser behavior and accessibility are NOT_MEASURED. Receipt: \`${proof.candidate.evidenceRoot}\\playwright\\execution.json\`.`
        : details.playwright
            ? `Playwright exit code: ${details.playwright.playwrightExitCode}; result: ${JSON.stringify(details.playwright.tests || {})}. Evidence: \`${proof.candidate.evidenceRoot}\\playwright\\execution.json\`.`
            : details.playwrightVerifierStep
            ? `Playwright runner ${details.playwrightVerifierStep.timedOut ? 'timed out' : 'did not produce an execution receipt'}; status: ${verificationStepState(details.playwrightVerifierStep)}. Browser results are NOT_MEASURED. Receipts: \`${proof.candidate.evidenceRoot}\\playwright\\execution.json\`.`
            : 'Playwright: NOT_RUN.';
    const unpricedCandidateCalls = Number.isFinite(details.realCandidate?.unpricedProviderCalls)
        ? details.realCandidate.unpricedProviderCalls : 'NOT_MEASURED';
    const rejectedCampaignAttempts = Number.isFinite(details.realCandidate?.campaignRejectedAttempts)
        ? details.realCandidate.campaignRejectedAttempts : 'NOT_MEASURED';
    const rejectedReservationLabel = rejectedCampaignAttempts === 1 ? 'rejected reservation' : 'rejected reservations';
    const observedIncompleteCost = Number.isFinite(comparisons.realGemini?.observedPricedProviderChargeUsdAcrossIncompleteAttempts)
        ? `$${comparisons.realGemini.observedPricedProviderChargeUsdAcrossIncompleteAttempts.toFixed(8)}` : 'NOT_MEASURED';
    const geminiBlock = details.realComparison?.comparisonValid === true
        ? `Credential status: ${comparisons.realGemini.credentialStatus || 'NOT_MEASURED'}; the process-scoped value is not recorded. Model: ${comparisons.realGemini.model || 'not recorded'}. Provider-reported traffic across matched arms: ${comparisons.realGemini.providerTextCallsBothEngines ?? 'NOT_MEASURED'} text and ${comparisons.realGemini.providerVisionCallsBothEngines ?? 'NOT_MEASURED'} vision calls. Request attempts across matched arms: ${comparisons.realGemini.textRequestAttemptsBothEngines ?? 'NOT_MEASURED'} text and ${comparisons.realGemini.visionRequestAttemptsBothEngines ?? 'NOT_MEASURED'} vision. Candidate run ledger: ${details.realCandidate?.requestAttempts ?? 'NOT_MEASURED'} request attempts, ${details.realCandidate?.providerUsageRecords ?? 'NOT_MEASURED'} provider usage records, ${rejectedCampaignAttempts} ${rejectedReservationLabel}. Estimated matched-pair spend from priced usage: $${Number(comparisons.realGemini.estimatedProviderChargeUsdBothEngines || 0).toFixed(8)}; provider invoice: NOT_AVAILABLE. Candidate route coverage: ${details.realCandidate?.routeExecutedTurns ?? 'NOT_MEASURED'}/200 executed, ${details.realCandidate?.routeNotRunTurns ?? 'NOT_MEASURED'} not run. Candidate quality gate: ${comparisons.realGemini.quality?.status || 'NOT_MEASURED'}; ${details.realCandidate?.verifiedCorrectAnswers ?? 'NOT_MEASURED'}/${details.realCandidate?.eligibleFactSlots ?? 'NOT_MEASURED'} fact slots and ${details.realCandidate?.verifiedCorrectTurns ?? 'NOT_MEASURED'}/${details.realCandidate?.evaluatedAnswerableProductTurns ?? 'NOT_MEASURED'} answerable turns verified; context resolution failures ${details.realCandidate?.contextResolutionFailures ?? 'NOT_MEASURED'} across ${details.realCandidate?.evaluatedContextDependentAnswerableTurns ?? 'NOT_MEASURED'}/${details.realCandidate?.contextDependentAnswerableTurns ?? 'NOT_MEASURED'} fully executed conversation chains (${details.realCandidate?.contextResolutionNotEvaluableTurns ?? 'NOT_MEASURED'} not evaluable); cross-domain safety ${details.realCandidate?.safeCrossDomainHandoffs ?? 'NOT_MEASURED'} safe, ${details.realCandidate?.unsafeCrossDomainHandoffs ?? 'NOT_MEASURED'} unsafe across ${details.realCandidate?.evaluatedCrossDomainHandoffTurns ?? 'NOT_MEASURED'}/${details.realCandidate?.crossDomainHandoffTurns ?? 'NOT_MEASURED'} executed turns (${details.realCandidate?.crossDomainHandoffNotRunTurns ?? 'NOT_MEASURED'} not run). Runner provenance: ${comparisons.realGemini.runnerProvenance?.status || 'NOT_MEASURED'}; paid/current runner hashes ${comparisons.realGemini.runnerProvenance?.paidCandidateRunnerSha256 || 'NOT_RECORDED'}/${comparisons.realGemini.runnerProvenance?.currentRunnerSha256 || 'NOT_RECORDED'}. Candidate unpriced provider calls: ${unpricedCandidateCalls}; ${unpricedCandidateCalls === 0 ? 'all recorded candidate provider usage was priced.' : unpricedCandidateCalls === 'NOT_MEASURED' ? 'provider pricing coverage was not measured from the run ledger.' : 'candidate provider cost estimate may be incomplete.'}`
        : details.realComparison
            ? `The matched Gemini comparison is incomplete; quality and matched-pair cost are NOT_MEASURED. No completed true-photo comparison is available. Observed model: ${comparisons.realGemini?.model || 'not recorded'}. Cumulative campaign ledger records ${comparisons.realGemini?.campaignLedger?.requestAttempts ?? 'NOT_MEASURED'} attempts (${comparisons.realGemini?.campaignLedger?.baselineAttempts ?? 'NOT_MEASURED'} baseline-stage, ${comparisons.realGemini?.campaignLedger?.candidateAttempts ?? 'NOT_MEASURED'} candidate-stage), including ${comparisons.realGemini?.campaignLedger?.providerTextCalls ?? 'NOT_MEASURED'} text and ${comparisons.realGemini?.campaignLedger?.providerVisionCalls ?? 'NOT_MEASURED'} vision provider-reported calls; ${comparisons.realGemini?.campaignLedger?.unpricedOrPendingRequests ?? 'NOT_MEASURED'} request(s) remain unpriced or pending. The estimated priced usage is ${observedIncompleteCost} from the cumulative campaign ledger; this is not matched-pair cost. Provider invoice: NOT_AVAILABLE.`
            : 'Credential status is not recorded in this proof. Paid Gemini evaluation: NOT_RUN.';
    const matchedPairCost = details.realComparison?.comparisonValid === true
        ? `$${Number(comparisons.realGemini?.estimatedProviderChargeUsdBothEngines || 0).toFixed(8)}`
        : details.realComparison ? 'NOT_MEASURED (comparison incomplete)' : 'NOT_RUN';
    const unpricedCostNote = details.realComparison?.comparisonValid === true
        ? `Candidate unpriced provider calls: ${unpricedCandidateCalls}. Rejected campaign ledger attempts: ${rejectedCampaignAttempts} (blocked before provider usage). ${unpricedCandidateCalls === 0 ? 'All recorded provider usage was priced.' : unpricedCandidateCalls === 'NOT_MEASURED' ? 'Provider pricing coverage was not measured from the run ledger.' : 'The candidate estimate may be incomplete.'}`
        : details.realComparison
            ? `Matched-pair cost is NOT_MEASURED because the comparison is incomplete. Candidate unpriced provider calls: ${unpricedCandidateCalls}; observed priced usage remains separate from the cumulative campaign ledger.`
            : 'Candidate unpriced provider calls: NOT_RUN.';
    const falseRefusalBlock = details.realComparison?.comparisonValid === true
        ? `Candidate false refusals: ${details.realCandidate?.falseRefusalSlots ?? 'NOT_MEASURED'} slots across ${details.realCandidate?.falseRefusalEvaluatedTurns ?? 'NOT_MEASURED'}/${details.realCandidate?.falseRefusalExpectedTurns ?? 'NOT_MEASURED'} evaluated/expected answerable turns (${details.realCandidate?.falseRefusalNotEvaluableTurns ?? 'NOT_MEASURED'} not evaluable).`
        : details.realComparison ? 'Paid false-refusal quality metrics: NOT_MEASURED; the matched comparison did not complete.' : 'Candidate false refusals: NOT_RUN.';
    const campaignBlock = details.campaign
        ? `Observed campaign activity remains in the cumulative ledger: ${details.campaign.requestCount}/${details.campaign.maxRequests} requests, ${details.campaign.visionRequestCount}/${details.campaign.maxVisionRequests} vision requests, ${details.campaignSummary?.providerUsageRecords ?? 'NOT_MEASURED'} provider-reported calls and ${details.campaignSummary?.unpricedOrPendingRequests ?? 'NOT_MEASURED'} unpriced or pending request(s). Estimated priced usage: $${Number(details.campaign.estimatedProviderChargeUsd || 0).toFixed(8)}; worst-case reserved: $${Number(details.campaign.reservedWorstCaseUsd || 0).toFixed(8)} of $${Number(details.campaign.ceilingUsd || 2).toFixed(2)} ceiling. Invoice unavailable.`
        : 'No campaign ledger is available.';
    const reconciliation = details.aggregateBudgetReconciliation || {};
    const aggregateBudgetBlock = reconciliation.ledgerSnapshotsComplete === false
        ? `Partial V1.3 ledger reconciliation: ${reconciliation.distinctCampaignCount ?? 0} parsed campaigns record ${reconciliation.requestCount ?? 'NOT_MEASURED'} requests and $${Number(reconciliation.reservedWorstCaseUsd || 0).toFixed(9)} known worst-case reserve, but ${reconciliation.malformedLedgerSnapshots?.length || 0} malformed ledger snapshot(s) were found. Aggregate exposure and remaining authorization are **INCOMPLETE / NOT_AVAILABLE**. The malformed snapshot paths and reasons are in the machine proof. Provider invoices are unavailable.`
        : Number.isFinite(reconciliation.reservedWorstCaseUsd)
            ? `Deduplicated latest ledgers across ${reconciliation.distinctCampaignCount} V1.3 campaigns record ${reconciliation.requestCount} requests, ${reconciliation.visionRequestCount} vision requests, ${reconciliation.unknownUsageRequestCount} unknown-usage calls, $${reconciliation.estimatedProviderChargeUsd.toFixed(8)} priced-token estimate and $${reconciliation.reservedWorstCaseUsd.toFixed(9)} reserved exposure. The sum of their individual ceilings is $${reconciliation.sumOfPerCampaignCeilingsUsd.toFixed(2)}; those ledgers do not enforce one shared aggregate cap. The V1.2 proof records $${Number(reconciliation.v1_2ConservativeTaskSeriesExposureUsd || 0).toFixed(8)} conservative task-series exposure, for combined reserve $${Number(reconciliation.combinedReservedExposureUsd || 0).toFixed(9)} and $${Number(reconciliation.remainingAggregateAuthorizationUsd || 0).toFixed(9)} remaining against the $${Number(reconciliation.authorizedAggregateBudgetUsd || 10).toFixed(2)} authorization by manual reconciliation. Provider invoices are unavailable. V1.2 source: \`${reconciliation.v1_2ProofSourcePath || 'NOT_RECORDED'}\`; V1.3 ledger file hashes and paths are in the machine proof.`
        : 'Aggregate V1.3 campaign exposure: NOT_MEASURED.';
    const independentBlock = details.independent
        ? 'Verdict: **' + status.INDEPENDENT_VERIFICATION + '**; reviewer: ' + (details.independent.reviewer || 'not recorded')
            + '; reviewed code commit: ' + (details.independent.reviewedCodeCommit || 'not recorded')
            + '; reviewed runner hash: ' + (details.independent.reviewedRunnerSourceSha256 || 'not recorded')
            + '; focused tests: ' + (details.independent.focusedTests?.testsPassed ?? 'NOT_MEASURED') + '/'
            + (details.independent.focusedTests?.testsTotal ?? 'NOT_MEASURED')
            + '; final scan: ' + (details.independent.finalPackageAudit?.privacyScanStatus || 'NOT_RECORDED')
            + '; manifest recomputation: ' + (details.independent.finalPackageAudit?.manifestRecomputation || 'NOT_RECORDED')
            + '; remaining limitations: ' + ((details.independent.limitations || []).join('; ') || 'none recorded') + '.'
        : 'Independent review: NOT_RUN.';
    const costPerAnswer = proof.measured.estimatedCostPerCandidateVerifiedAnswerUsd;
    const costPerFactSlot = proof.measured.estimatedCostPerCandidateVerifiedFactSlotUsd;
    const paidRouteTiming = details.realComparison?.comparisonValid === true
        ? `Paid candidate route p50/p95: ${details.realCandidate?.p50RouteMs ?? 'NOT_MEASURED'} ms / ${details.realCandidate?.p95RouteMs ?? 'NOT_MEASURED'} ms; baseline: ${details.realBaseline?.p50RouteMs ?? 'NOT_MEASURED'} ms / ${details.realBaseline?.p95RouteMs ?? 'NOT_MEASURED'} ms. Paid candidate provider p50/p95: ${details.realCandidate?.p50ProviderMs ?? 'NOT_MEASURED'} ms / ${details.realCandidate?.p95ProviderMs ?? 'NOT_MEASURED'} ms (baseline ${details.realBaseline?.p50ProviderMs ?? 'NOT_MEASURED'} ms / ${details.realBaseline?.p95ProviderMs ?? 'NOT_MEASURED'} ms).`
        : 'Paid candidate and provider route timings: NOT_MEASURED.';
    const paidComparisonBlock = details.realComparison?.comparisonValid === true
        ? `Paid Gemini source comparison: verified fact answers ${details.realBaseline?.verifiedCorrectAnswers ?? 'NOT_MEASURED'}/${details.realBaseline?.eligibleFactSlots ?? 'NOT_MEASURED'} baseline to ${details.realCandidate?.verifiedCorrectAnswers ?? 'NOT_MEASURED'}/${details.realCandidate?.eligibleFactSlots ?? 'NOT_MEASURED'} candidate; fully answered turns ${details.realBaseline?.verifiedCorrectTurns ?? 'NOT_MEASURED'}/${details.realBaseline?.evaluatedAnswerableProductTurns ?? 'NOT_MEASURED'} baseline to ${details.realCandidate?.verifiedCorrectTurns ?? 'NOT_MEASURED'}/${details.realCandidate?.evaluatedAnswerableProductTurns ?? 'NOT_MEASURED'} candidate. Quality verdict: ${comparisons.realGemini?.quality?.status || status.REAL_GEMINI_QUALITY_VERDICT || 'NOT_MEASURED'}. Paid matched-pair estimated cost: $${Number(comparisons.realGemini?.estimatedProviderChargeUsdBothEngines || 0).toFixed(8)}; candidate $${Number(details.realCandidate?.estimatedProviderChargeUsd || 0).toFixed(8)} vs baseline $${Number(details.realBaseline?.estimatedProviderChargeUsd || 0).toFixed(8)} (${comparisons.realGemini?.metricOutcomes?.estimatedProviderChargeUsd || 'NOT_MEASURED'}). Paid route p95 outcome: ${comparisons.realGemini?.metricOutcomes?.p95RouteMs || 'NOT_MEASURED'}; provider p95 outcome: ${details.realCandidate?.p95ProviderMs < details.realBaseline?.p95ProviderMs ? 'IMPROVED' : details.realCandidate?.p95ProviderMs > details.realBaseline?.p95ProviderMs ? 'REGRESSED' : 'EQUIVALENT'}. Paid public-photo probe: category ${details.photoCategoryMatches ?? 'NOT_MEASURED'}/${details.photosTested ?? 'NOT_MEASURED'}, visible color ${details.photoColorMatches ?? 'NOT_MEASURED'}/${details.photosTested ?? 'NOT_MEASURED'}; catalog identity ${details.photoIdentityScored ? 'SCORED' : 'NOT SCORED'}.`
        : 'Paid Gemini baseline comparison: NOT_MEASURED.';
    return `# EasyModerator Product Engine V1.3 — Integration & Customer Truth Proof

Generated: ${proof.generatedAt}

## A. Executive verdict

| Gate | Result |
|---|---|
| Automated QA | ${status.AUTOMATED_QA_VERDICT} |
| Integration ready | ${status.INTEGRATION_READY} |
| Deterministic source truth (zero provider calls) | ${status.DETERMINISTIC_SOURCE_TRUTH_VERDICT} |
| Gemini comparison | ${status.REAL_GEMINI_STATUS || 'NOT_CAPTURED'} |
| Gemini credential | ${status.REAL_GEMINI_CREDENTIAL_STATUS || 'NOT_CAPTURED'} |
| Real Gemini candidate quality | ${status.REAL_GEMINI_QUALITY_VERDICT} |
| Real Gemini photo acceptance | ${status.REAL_GEMINI_VISION_VERDICT || 'NOT_CAPTURED'} |
| Browser QA | ${status.PLAYWRIGHT_E2E || 'NOT_CAPTURED'} |
| Backend security tests | ${status.SECURITY_TESTS || 'NOT_CAPTURED'} |
| Verification receipt | ${status.VERIFICATION_ENTRYPOINT_STATUS || 'NOT_CAPTURED'} (${status.VERIFICATION_ENTRYPOINT_COMPLETE || 'NO'} complete) |
**Commercial evidence:** ${status.COMMERCIAL_EVIDENCE_VERDICT}

This local verification evaluates the existing V1.2 Product Engine against an independently generated catalog oracle, a synthetic held-out set, the disposable local PostgreSQL/Redis/worker path, and baseline/candidate replays. Each result is limited to its recorded receipt. Production, live Meta delivery, merchant outcomes, conversion and ROI were not tested.

The candidate is ${status.INTEGRATION_READY === 'YES' ? 'eligible for scoped integration review' : 'not eligible for integration readiness yet'}. The evidence below identifies the remaining gates and does not treat safe fallback as a verified answer.

## B. Source control and isolation

- V1.2 baseline: \`${status.V1_2_BASE_SHA}\`.
- V1.3 tested code commit: \`${status.V1_3_FINAL_SHA}\` on \`${status.V1_3_BRANCH}\`.
- Evidence checkout: \`${proof.candidate.worktree}\`.
- Evidence package root: \`${proof.candidate.evidenceRoot}\`.
- Backend source SHA-256: \`${proof.candidate.backendSourceSha256}\`.
- Worktree clean at verification start: **${proof.candidate.cleanAtVerificationStart === true ? 'YES' : proof.candidate.cleanAtVerificationStart === false ? 'NO' : 'UNKNOWN'}**.
- Worktree clean when the proof was generated: **${proof.candidate.cleanWhenProofGenerated === true ? 'YES' : proof.candidate.cleanWhenProofGenerated === false ? 'NO' : 'UNKNOWN'}**. Verification receipt: \`${proof.verificationEntryPoint?.receiptPath || 'NOT_CAPTURED'}\`.
- Other agent worktrees touched: **NO**. Production changed: **NO**. Push, merge and deploy: **NO**.
- Production release remains unauthorized.

## C. Implementation changes

The candidate extends the existing intent router, product evidence and Test Lab. V1.3 corrections cover product context re-fetching, mixed product-price and delivery-fee questions, negotiation versus catalog-price classification, garment measurements, category-incompatible context, Bengali-digit PII masking, independent answerability denominators, and source/held-out oracle provenance. The decision record is [MULTI_AGENT_DECISION_RECORD.md](MULTI_AGENT_DECISION_RECORD.md).

Order creation, payment confirmation, stock reservation, courier booking, live Meta delivery and new provider architecture remain outside the Product Engine boundary.

## D. Deterministic source truth

This verdict covers the zero-provider-call replay against the source oracle only. The paid Gemini candidate quality gate is ${details.realGeminiQuality?.status || status.REAL_GEMINI_QUALITY_VERDICT || 'NOT_MEASURED'}.

${sourceLine}

The source CSV SHA-256 is \`${proof.benchmark.sourceCorpusSha256}\`. Its advisory \`Expected AI Truth\` cells are not the source of oracle answers. Only TEXT turns enter text answerability metrics; image-bearing turns without pixels are excluded from those denominators.

| Metric | V1.2 | V1.3 |
|---|---:|---:|
| Verified correct fact answers | ${details.sourceBaseline?.verifiedCorrectAnswers ?? 'NOT_RUN'} | ${details.sourceCandidate?.verifiedCorrectAnswers ?? 'NOT_RUN'} |
| Fully answered product turns | ${details.sourceBaseline?.verifiedCorrectTurns ?? 'NOT_RUN'} | ${details.sourceCandidate?.verifiedCorrectTurns ?? 'NOT_RUN'} |
| False refusal slots | ${details.sourceBaseline?.falseRefusalSlots ?? 'NOT_RUN'} | ${details.sourceCandidate?.falseRefusalSlots ?? 'NOT_RUN'} |
| False-refusal turns evaluated / expected (not evaluable) | ${details.sourceBaseline?.falseRefusalEvaluatedTurns ?? 'NOT_RUN'} / ${details.sourceBaseline?.falseRefusalExpectedTurns ?? 'NOT_RUN'} (${details.sourceBaseline?.falseRefusalNotEvaluableTurns ?? 'NOT_RUN'}) | ${details.sourceCandidate?.falseRefusalEvaluatedTurns ?? 'NOT_RUN'} / ${details.sourceCandidate?.falseRefusalExpectedTurns ?? 'NOT_RUN'} (${details.sourceCandidate?.falseRefusalNotEvaluableTurns ?? 'NOT_RUN'}) |
| Unsupported price claims with SEND disposition | ${details.sourceBaseline?.unsupportedClaimsSent ?? 'NOT_RUN'} | ${details.sourceCandidate?.unsupportedClaimsSent ?? 'NOT_RUN'} |
| Context-resolution failures | ${details.sourceBaseline?.contextResolutionFailures ?? 'NOT_RUN'} | ${details.sourceCandidate?.contextResolutionFailures ?? 'NOT_RUN'} |
| Context turns evaluated / expected | ${details.sourceBaseline?.evaluatedContextDependentAnswerableTurns ?? 'NOT_RUN'} / ${details.sourceBaseline?.contextDependentAnswerableTurns ?? 'NOT_RUN'} | ${details.sourceCandidate?.evaluatedContextDependentAnswerableTurns ?? 'NOT_RUN'} / ${details.sourceCandidate?.contextDependentAnswerableTurns ?? 'NOT_RUN'} |
| Context turns not evaluable | ${details.sourceBaseline?.contextResolutionNotEvaluableTurns ?? 'NOT_RUN'} | ${details.sourceCandidate?.contextResolutionNotEvaluableTurns ?? 'NOT_RUN'} |
| Safe cross-domain handoffs | ${details.sourceBaseline?.safeCrossDomainHandoffs ?? 'NOT_RUN'} | ${details.sourceCandidate?.safeCrossDomainHandoffs ?? 'NOT_RUN'} |
| Cross-domain handoffs evaluated / expected | ${details.sourceBaseline?.evaluatedCrossDomainHandoffTurns ?? 'NOT_RUN'} / ${details.sourceBaseline?.crossDomainHandoffTurns ?? 'NOT_RUN'} | ${details.sourceCandidate?.evaluatedCrossDomainHandoffTurns ?? 'NOT_RUN'} / ${details.sourceCandidate?.crossDomainHandoffTurns ?? 'NOT_RUN'} |
| Cross-domain handoffs not run | ${details.sourceBaseline?.crossDomainHandoffNotRunTurns ?? 'NOT_RUN'} | ${details.sourceCandidate?.crossDomainHandoffNotRunTurns ?? 'NOT_RUN'} |

${qualityMetricAuditBlock}

Incorrect product answers are **not separately measured**. The artifact records ${details.totalIncorrectOrUnansweredSlots ?? 'NOT_MEASURED'} answerable fact slots that were partial, unanswered or incorrect; this total includes false refusals and must not be presented as a wrong-answer count. The currently measured unsupported-claim counter is specifically an unsupported-price-claim check.

False-refusal scoring accepts a current turn with VERIFIED product evidence and a matching contract-valid READY presentation. Otherwise, a context-dependent turn is evaluated only when every earlier turn in that conversation executed and an earlier assistant turn had a SEND disposition for a non-refusal reply with a contract-valid READY presentation grounding the same product. This is approved replay output; actual Messenger delivery is not established. An intervening product \`NOT_FOUND\` clears prior assistant context; context-only turns without current evidence and a complete grounding chain remain not evaluable.

${exampleText}

## E. Gemini

${geminiBlock}

${falseRefusalBlock}

${campaignBlock}

${supplementaryProRuns.length ? `Separate evaluation-only Pro diagnostics: ${supplementaryProSummary.providerRequests ?? 'NOT_MEASURED'} requests; $${Number(supplementaryProSummary.estimatedProviderChargeUsd || 0).toFixed(6)} token-priced estimate; $${Number(supplementaryProSummary.reservedWorstCaseUsd || 0).toFixed(6)} worst-case reservation. They are outside the matched Gemini Lite comparison and do not change the production model.` : 'Supplementary Pro diagnostic: NOT_RUN.'}

Provider estimates use reported token usage and a pinned local rate calculation. They are not billing records. The credential is process-scoped and is not copied into artifacts.

## F. Images

${imageBlock}

${supplementaryProBlock}

${supplementaryLitePhotoBlock}

${visualCaseCoverageBlock}

No source-corpus image pixels were available. The three independent photos are licensed public fixtures; results should not be generalized to customer photos. ${details.realComparison?.comparisonValid === true ? 'The detailed provenance and per-photo observations are in the machine-readable proof.' : 'No completed per-photo comparison is reported.'}

## G. Backend integration

${integrationBlock}

Product search: **${status.PRODUCT_SEARCH_INTEGRATION}**. Fake Meta transport: **${status.FAKE_META_TRANSPORT}**. These checks do not establish production database behavior or live Meta delivery. Disposable service receipts: \`${proof.candidate.evidenceRoot}\\integration\`.

## H. Browser QA

${browserBlock}

The Playwright runner starts a loopback Test Lab for the browser run and stops it afterward; no persistent Test Lab URL is claimed by this report.

## I. Security and privacy

- Security tests: **${status.SECURITY_TESTS}**. Egress guard: ${proof.security.egress?.guard || 'NOT_RUN'}; blocked non-loopback attempts: ${proof.security.egress?.blockedNonLoopbackAttempts ?? 'NOT_MEASURED'}.
- Tenant violations: ${details.sourceCandidate?.tenantViolations ?? 'NOT_RUN'}; unscoped catalog reads: ${details.sourceCandidate?.unscopedReads ?? 'NOT_RUN'}.
- Pre-proof artifact privacy scan: **${status.PRIVACY_SCAN}** at ${proof.security.privacyScan?.checkedAt || 'NOT_RECORDED'}. The final scan report and checksum manifest are generated after this proof; inspect their timestamps and entries to confirm coverage. The proof Markdown is at \`${proof.candidate.evidenceRoot}\\reports\\product-engine-v1.3-proof.md\`, and the machine proof is at \`${proof.candidate.evidenceRoot}\\product-engine-v1.3-proof.json\`.
- No credential values are stored in the proof package.

## J. Cost and merchant economics

Estimated matched-pair provider cost from priced usage: ${matchedPairCost}. ${unpricedCostNote} Candidate cost per verified product-answer turn: ${costPerAnswer == null ? 'NOT_MEASURED' : `$${costPerAnswer.toFixed(8)}`}; per verified fact slot: ${costPerFactSlot == null ? 'NOT_MEASURED' : `$${costPerFactSlot.toFixed(8)}`}. Deterministic source replay router p50/p95: ${details.sourceCandidate?.p50RouteMs ?? 'NOT_RUN'} ms / ${details.sourceCandidate?.p95RouteMs ?? 'NOT_RUN'} ms. ${paidRouteTiming} These route timings exclude webhook, queue, database and customer-facing network latency.

${aggregateBudgetBlock}

No merchant time saved, adoption, order outcomes, conversion or ROI data exists in this test. Commercial evidence is therefore **NOT ESTABLISHED**.

## K. Baseline comparison

- Source comparison: ${sourceComparisonBlock}
- Held-out comparison: ${heldoutBlock}
- ${paidComparisonBlock}
- Deterministic and paid model results are kept separate. Comparison outputs include dataset, oracle, catalog, engine-source and runner hashes.

## L. Independent verification

${independentBlock}

The review applies to the exact code SHA and runner hash recorded above. Any code change after that review invalidates its verdict. Product QA and integration remain at the statuses shown in Section A.

## M. Remaining decisions

| Task | Classification | Evidence/status |
|---|---|---|
| Resolve any remaining text, context or vision failures | Required before integration | Deterministic source truth: ${status.DETERMINISTIC_SOURCE_TRUTH_VERDICT}; paid Gemini quality: ${status.REAL_GEMINI_QUALITY_VERDICT}; vision results are listed above. |
| Complete the required visual case matrix and score catalog identity | Required before integration | ${details.visualCaseCoverage?.representedCaseTypes ?? 0}/${details.visualCaseCoverage?.requiredCaseTypes ?? REQUIRED_VISUAL_CASES.length} case types represented; catalog SKU identity ${details.photoIdentityScored ? 'scored' : 'NOT_MEASURED'}. |
| Measure held-out Gemini usefulness and separately score customer-answer quality metrics | Required before integration | Held-out Gemini ${status.REAL_GEMINI_HELDOUT_EVALUATION}; customer usefulness ${status.CUSTOMER_USEFULNESS_SCORE}; metric coverage table is in Section D. |
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

Machine-readable proof: \`${proof.candidate.evidenceRoot}\\product-engine-v1.3-proof.json\`.

| Status key | Value |
|---|---|
${metricTable}
`;
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`Proof generation failed: ${String(error?.message || 'UNKNOWN_ERROR')}\n`);
        process.exitCode = 1;
    }
}

module.exports = { assessAutomatedQaVerdict, assessGenuinePhotoQuality, assessPlaywrightExecution, assessRealGeminiQuality, backendSourceSha256, calculateCandidateCostMetrics, collectGeminiLitePhotoDiagnostics, collectGeminiProPhotoDiagnostics, independentVerificationMatches, independentVerificationStatus, isIntegrationServiceReady, matchesCurrentVerificationCommit, matchingComparison, newestMatching, privacyScanPassed, reconcileV13CampaignBudget, renderMarkdown, safeExamples, summarizeCampaignLedger, summarizeGeminiProDiagnostics, summarizeRequiredVisualCaseCoverage, summarizeRunLedger, worktreeStatusFields };
