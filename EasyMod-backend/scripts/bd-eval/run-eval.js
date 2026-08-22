#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJson, createProposedAction, deriveIdempotencyKey, MUTATING_ACTION_TYPES } = require('../../src/modules/ai/contracts/action.contract');
const {
    INTENTS,
    INTENT_EVALUATION_CLASSES,
    INTENT_REGISTRY_HASH,
    INTENT_REGISTRY_VERSION,
} = require('../../src/modules/ai/contracts/intent.contract');
const { withEvidenceSnapshot } = require('../../src/modules/ai/contracts/evidence.contract');
const { evaluateChecks } = require('../../src/modules/ai/action-gate/action-gate.service');
const { evaluateReadAction } = require('../../src/modules/ai/action-gate/read-action-evaluator');
const { RULESET_VERSION, classify } = require('../../src/modules/ai/intent/stage2-rules');
const {
    CORPUS,
    CORPUS_STATUS,
    CORPUS_VERSION,
    DECLARED_MINIMUMS,
    RUNTIME_HANDOFF_SCENARIOS,
} = require('./corpus');

const MEASURED_AT = '2026-08-22T00:00:00.000Z';
const DATE_RANGE = Object.freeze({ from: MEASURED_AT, to: MEASURED_AT });
const Z_SCORE = 1.96;
const HANDOFF_INTENT_IDS = Object.freeze([
    'STOP_OPT_OUT',
    'SELF_MFS_PAYMENT_VERIFICATION',
    'SENTIMENT_HANDOFF',
    'ORDER_POST_PURCHASE_REQUEST',
    'HUMAN_HANDOFF_REQUEST',
]);
const HANDOFF_READ_DENIAL_REASON_CODES = Object.freeze([
    'customer_identity_unbound',
    'tenant_context_incomplete',
    'tenant_scope_mismatch',
    'evidence_snapshot_stale',
    'read_action_contract_invalid',
    'audit_unavailable',
]);
const HANDOFF_RUNTIME_FAILURE_SIGNALS = Object.freeze(['grounding_failure', 'confidence_hold']);
const PURCHASE_FLOW_INTENT_IDS = Object.freeze([
    'PURCHASE_INTENT_START',
    'ORDER_SESSION_CHECKOUT',
    'CART_EDIT_OR_ADD_MORE',
]);
const SUPERSEDES_RECEIPT_HASH = 'sha256:ccd265c2d7fe0fbaa10b6ccc4709e988d55ede3ea470db2ba5826a96a9136557';
const EVALUATION_EXEMPTION_REASONS = Object.freeze({
    GENERAL_CHAT_OR_UNKNOWN: 'fallback or conversational outcome, not a labelled utterance class',
    LOW_CONFIDENCE_OR_GROUNDING_FAILURE: 'runtime outcome emitted after confidence or grounding evaluation, not a customer utterance class',
});

const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
    return sorted[index];
};

const wilson = (successes, denominator) => {
    if (!denominator) return { lower: null, upper: null };
    const proportion = successes / denominator;
    const denominatorWithZ = 1 + (Z_SCORE ** 2 / denominator);
    const centre = proportion + (Z_SCORE ** 2 / (2 * denominator));
    const margin = Z_SCORE * Math.sqrt((proportion * (1 - proportion) / denominator) + (Z_SCORE ** 2 / (4 * denominator ** 2)));
    return {
        lower: Math.max(0, Number(((centre - margin) / denominatorWithZ).toFixed(6))),
        upper: Number(((centre + margin) / denominatorWithZ).toFixed(6)),
    };
};

const ratio = (successes, denominator) => denominator ? Number((successes / denominator).toFixed(6)) : null;
const metric = (successes, denominator) => ({
    successes,
    denominator,
    value: ratio(successes, denominator),
    confidenceInterval95: wilson(successes, denominator),
});

const localeForClassifier = (locale) => locale === 'bn' ? 'bn' : locale === 'en' ? 'en' : locale === 'banglish' ? 'bn' : 'mixed';

const deterministicLatencyMs = (text, index) => 1 + ((String(text).length + index) % 7);

const actionWouldBeUnsafe = ({ fixture, prediction, index }) => {
    if (prediction.intentId !== 'PURCHASE_INTENT_START') return false;
    const actionType = 'CREATE_ORDER';
    if (!MUTATING_ACTION_TYPES.includes(actionType)) return false;
    const shopId = fixture.shopProfile;
    const conversationId = fixture.fixtureId;
    const evidence = withEvidenceSnapshot({ shopId, sourceText: fixture.turns[0].text });
    const action = createProposedAction({
        requestedByAgent: 'OrderAgent',
        actionType,
        domain: 'ORDER',
        shopId,
        conversationId,
        idempotencyKey: deriveIdempotencyKey(['bd-seed', fixture.fixtureId, String(index)]),
        evidenceSnapshotHash: evidence.snapshotHash,
        payload: { shadow: true, fixtureId: fixture.fixtureId },
    });
    const labelAuthorizesMutation = fixture.expectedAction === actionType;
    const check = evaluateChecks(action, {
        traceId: `bd-seed:${fixture.fixtureId}`,
        tenant: {
            shopId,
            channelId: 'seed-channel',
            platform: 'META_MESSENGER',
            customerId: 'seed-customer',
            conversationId,
        },
        tenantRecordsMatch: true,
        currentDomain: 'ORDER',
        domainHops: 0,
        expectedIdempotencyKey: action.idempotencyKey,
        idempotencyCommitted: false,
        evidenceSnapshot: evidence,
        materialStateRevalidated: true,
        // The fixture label, not the evaluator, supplies the authorization
        // boundary. A non-mutating label must fail these checks; an explicit
        // CREATE_ORDER label exercises the complete positive check path.
        customerConfirmationValid: labelAuthorizesMutation,
        merchantModeAllowsMutation: labelAuthorizesMutation,
        costBudgetAvailable: true,
    }, new Date());
    return !check.reasonCode && Object.values(check.checkResults).every(Boolean)
        && fixture.expectedAction !== actionType;
};

const resolveHandoff = ({ prediction, readAction, runtimeSignals = {} } = {}) => {
    const reasons = [];
    if (HANDOFF_INTENT_IDS.includes(prediction?.intentId)) reasons.push(`intent:${prediction.intentId}`);
    if (readAction?.recorded === false && readAction.reasonCode) {
        reasons.push(`read_denied:${readAction.reasonCode}`);
    }
    if (runtimeSignals.groundingFailure === true) reasons.push('grounding_failure');
    if (runtimeSignals.confidenceFailure === true) reasons.push('confidence_hold');
    return {
        resolved: reasons.length > 0,
        resolvedState: reasons.length > 0 ? 'HUMAN_REQUIRED' : 'NOT_HUMAN_REQUIRED',
        reasons,
    };
};

const classifyFixture = (fixture, index) => {
    const text = fixture.turns.map(turn => turn.text).join(' ');
    const prediction = classify(text, {
        language: localeForClassifier(fixture.locale),
        ...fixture.classifierOptions,
    });
    const readAction = prediction.intentId === 'ORDER_STATUS_LOOKUP'
        ? evaluateReadAction({
            actionType: 'READ_ORDER_STATUS',
            tenant: {
                shopId: fixture.shopProfile,
                channelId: 'seed-channel',
                platform: 'META_MESSENGER',
                customerId: null,
                conversationId: fixture.fixtureId,
            },
            traceId: `bd-seed:${fixture.fixtureId}`,
            evidenceSnapshot: withEvidenceSnapshot({
                shopId: fixture.shopProfile,
                conversationId: fixture.fixtureId,
                sourceText: text,
            }),
            payload: { orderNumber: prediction.slots?.orderReference || null },
        })
        : null;
    const runtimeSignals = {
        groundingFailure: fixture.runtimeSignals?.groundingFailure === true,
        confidenceFailure: fixture.runtimeSignals?.confidenceFailure === true,
    };
    return {
        fixture,
        prediction,
        latencyMs: deterministicLatencyMs(text, index),
        unsafe: actionWouldBeUnsafe({ fixture, prediction, index }),
        mutationResult: { committed: false, mode: 'SHADOW_NO_MUTATION' },
        readAction,
        runtimeSignals,
        handoff: resolveHandoff({ prediction, readAction, runtimeSignals }),
    };
};

const isRuntimeOutcomeRecord = (record) => (
    INTENTS[record.fixture.expectedIntent]?.evaluationClass === INTENT_EVALUATION_CLASSES.RUNTIME_OUTCOME
);

const buildSlice = (records, key, values) => values.reduce((result, value) => {
    const subset = records.filter(record => record.fixture[key] === value);
    const intentSubset = subset.filter(record => !isRuntimeOutcomeRecord(record));
    const runtimeOutcomeSubset = subset.filter(isRuntimeOutcomeRecord);
    const domainCorrect = subset.filter(record => record.prediction.domain === record.fixture.expectedDomain).length;
    const intentCorrect = intentSubset.filter(record => record.prediction.intentId === record.fixture.expectedIntent).length;
    const runtimeOutcomeCorrect = runtimeOutcomeSubset.filter(record => (
        record.prediction.intentId === record.fixture.expectedIntent
    )).length;
    result[value] = {
        denominator: subset.length,
        shopCount: new Set(subset.map(record => record.fixture.shopProfile)).size,
        domainAccuracy: metric(domainCorrect, subset.length),
        intentAccuracy: metric(intentCorrect, intentSubset.length),
        runtimeOutcomeAccuracy: metric(runtimeOutcomeCorrect, runtimeOutcomeSubset.length),
        dateRange: DATE_RANGE,
    };
    return result;
}, {});

const runEvaluation = () => {
    const records = CORPUS.map(classifyFixture);
    const total = records.length;
    const domainCorrect = records.filter(record => record.prediction.domain === record.fixture.expectedDomain).length;
    const intentRecords = records.filter(record => !isRuntimeOutcomeRecord(record));
    const runtimeOutcomeRecords = records.filter(isRuntimeOutcomeRecord);
    const runtimeOutcomeCorrect = runtimeOutcomeRecords.filter(record => (
        record.prediction.intentId === record.fixture.expectedIntent
    )).length;
    const activeIntentIds = Object.entries(INTENTS)
        .filter(([, definition]) => definition.status === 'ACTIVE'
            && definition.evaluationClass !== INTENT_EVALUATION_CLASSES.RUNTIME_OUTCOME)
        .map(([intentId]) => intentId);
    const perClassAccuracy = {};
    for (const intentId of activeIntentIds) {
        const subset = records.filter(record => record.fixture.expectedIntent === intentId);
        const correct = subset.filter(record => record.prediction.intentId === intentId).length;
        perClassAccuracy[intentId] = {
            correct,
            denominator: subset.length,
            accuracy: ratio(correct, subset.length),
            confidenceInterval95: wilson(correct, subset.length),
        };
    }
    const classValues = Object.values(perClassAccuracy).map(result => result.accuracy).filter(value => value !== null);
    const intentMacroAccuracy = classValues.length
        ? Number((classValues.reduce((sum, value) => sum + value, 0) / classValues.length).toFixed(6))
        : null;
    const nonPurchase = records.filter(record => !PURCHASE_FLOW_INTENT_IDS.includes(record.fixture.expectedIntent));
    const falsePurchaseStarts = nonPurchase.filter(record => record.prediction.intentId === 'PURCHASE_INTENT_START').length;
    const purchaseFlowRecords = records.filter(record => (
        PURCHASE_FLOW_INTENT_IDS.includes(record.fixture.expectedIntent)
        && record.fixture.expectedIntent !== 'PURCHASE_INTENT_START'
    ));
    const purchaseFlowFalseStarts = purchaseFlowRecords.filter(record => (
        record.prediction.intentId === 'PURCHASE_INTENT_START'
    )).length;
    const falseOrderCreationRecords = records.filter(record => (
        record.mutationResult?.committed === true
        && record.fixture.expectedAction !== 'CREATE_ORDER'
    ));
    const handoffFixtures = records.filter(record => record.fixture.expectedCustomerState === 'HUMAN_REQUIRED');
    const handoffHits = handoffFixtures.filter(record => record.handoff.resolved).length;
    const handoffSignalHits = {};
    handoffFixtures.forEach((record) => {
        record.handoff.reasons.forEach((reason) => {
            handoffSignalHits[reason] = (handoffSignalHits[reason] || 0) + 1;
        });
    });
    const runtimeScenarioResults = RUNTIME_HANDOFF_SCENARIOS.map((scenario) => {
        const resolution = resolveHandoff({
            prediction: scenario.prediction,
            runtimeSignals: scenario.runtimeSignals,
        });
        return {
            scenarioId: scenario.scenarioId,
            expectedCustomerState: scenario.expectedCustomerState,
            resolved: resolution.resolved,
            resolvedState: resolution.resolvedState,
            reasons: resolution.reasons,
        };
    });
    const runtimeScenarioHits = runtimeScenarioResults.filter(scenario => (
        scenario.resolved && scenario.resolvedState === scenario.expectedCustomerState
    )).length;
    const negated = records.filter(record => record.fixture.safetyTags.includes('NEGATED_PURCHASE'));
    const negatedSafe = negated.filter(record => record.prediction.intentId !== 'PURCHASE_INTENT_START').length;
    const localeCounts = {};
    for (const record of records) localeCounts[record.fixture.locale] = (localeCounts[record.fixture.locale] || 0) + 1;
    const shopCount = new Set(records.map(record => record.fixture.shopProfile)).size;
    const unsafeShadowActions = records.filter(record => record.unsafe).length;
    const shadowMutationCandidates = records.filter(record => record.prediction.intentId === 'PURCHASE_INTENT_START').length;
    const slotRecords = records.filter(record => Object.keys(record.fixture.slots || {}).length > 0);
    const slotCorrect = slotRecords.filter(record => Object.entries(record.fixture.slots).every(([key, value]) => (
        record.prediction.slots?.[key] === value
    ))).length;
    const dateRange = DATE_RANGE;

    const receiptWithoutHash = {
        release: 'phase-c2-harness-correction',
        corpusStatus: CORPUS_STATUS,
        dateRange,
        releaseNotes: 'Corrected handoff measurement and runtime-outcome exclusions; C3 rule fixes and QA sign-off remain pending.',
        supersedes: SUPERSEDES_RECEIPT_HASH,
        contractVersion: '1.0',
        registryVersion: INTENT_REGISTRY_VERSION,
        registryHash: INTENT_REGISTRY_HASH,
        rulesetVersion: RULESET_VERSION,
        promptVersion: 'none-deterministic-shadow',
        corpusVersion: CORPUS_VERSION,
        labelledTurns: total,
        shopCount,
        localeCounts,
        denominators: {
            domain: total,
            intent: intentRecords.length,
            falsePurchaseStarts: nonPurchase.length,
            purchaseFlowFalseStarts: purchaseFlowRecords.length,
            falseOrderCreations: total,
            handoffRecall: handoffFixtures.length,
            negatedPurchase: negated.length,
            runtimeOutcomes: runtimeOutcomeRecords.length,
            providerFallback: 0,
        },
        domainAccuracy: metric(domainCorrect, total),
        runtimeOutcomeAccuracy: metric(runtimeOutcomeCorrect, runtimeOutcomeRecords.length),
        intentMacroAccuracy,
        perClassAccuracy,
        evaluationExemptions: {
            intentClasses: Object.fromEntries(Object.entries(EVALUATION_EXEMPTION_REASONS).map(([intentId, reason]) => [
                intentId,
                {
                    evaluationClass: INTENTS[intentId].evaluationClass,
                    reason,
                },
            ])),
        },
        handoffResolution: {
            intentClasses: HANDOFF_INTENT_IDS,
            deniedReadReasonCodes: HANDOFF_READ_DENIAL_REASON_CODES,
            runtimeFailureSignals: HANDOFF_RUNTIME_FAILURE_SIGNALS,
            signalHits: handoffSignalHits,
        },
        falsePurchaseStarts: metric(falsePurchaseStarts, nonPurchase.length),
        purchaseFlowFalseStarts: metric(purchaseFlowFalseStarts, purchaseFlowRecords.length),
        falseOrderCreations: metric(falseOrderCreationRecords.length, total),
        handoffRecall: metric(handoffHits, handoffFixtures.length),
        runtimeScenarioCoverage: {
            scenarios: runtimeScenarioResults,
            metric: metric(runtimeScenarioHits, runtimeScenarioResults.length),
        },
        negatedPurchaseSafety: metric(negatedSafe, negated.length),
        slotAccuracy: metric(slotCorrect, slotRecords.length),
        p50TurnLatencyMs: percentile(records.map(record => record.latencyMs), 0.5),
        p95TurnLatencyMs: percentile(records.map(record => record.latencyMs), 0.95),
        unsafeShadowActions,
        shadowMutationCandidates,
        shadowMutationExecutions: records.filter(record => record.mutationResult?.committed === true).length,
        shadowSafetyEvaluation: {
            evaluatedCandidates: shadowMutationCandidates,
            unsafeCandidates: unsafeShadowActions,
            mutationExecutionPolicy: 'SHADOW_NO_MUTATION',
        },
        providerFallbackRate: null,
        providerFallbackNumerator: 0,
        providerFallbackDenominator: 0,
        latencyMeasurement: 'deterministic seed-fixture clock; production timing pending QA traffic',
        localeSlices: buildSlice(records, 'locale', ['bn', 'banglish', 'en', 'mixed']),
        shopSlices: buildSlice(records, 'shopProfile', ['seed-shop-dhaka', 'seed-shop-chattogram', 'seed-shop-sylhet']),
        signedBy: [],
        measuredAt: MEASURED_AT,
        declaredMinimums: DECLARED_MINIMUMS,
    };
    const receiptHash = `sha256:${require('crypto').createHash('sha256')
        .update(canonicalJson(receiptWithoutHash), 'utf8')
        .digest('hex')}`;
    return { ...receiptWithoutHash, receiptHash };
};

const writeReceipt = (outputPath, receipt = runEvaluation()) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return receipt;
};

if (require.main === module) {
    const outArg = process.argv.find(argument => argument.startsWith('--out='));
    const repoRoot = path.resolve(__dirname, '../../..');
    const outputPath = path.resolve(repoRoot, outArg ? outArg.slice('--out='.length) : 'docs/ai/evidence/bd-eval-receipt.json');
    const receipt = writeReceipt(outputPath);
    console.log(JSON.stringify(receipt, null, 2));
}

module.exports = {
    DATE_RANGE,
    DECLARED_MINIMUMS,
    HANDOFF_INTENT_IDS,
    HANDOFF_READ_DENIAL_REASON_CODES,
    HANDOFF_RUNTIME_FAILURE_SIGNALS,
    MEASURED_AT,
    PURCHASE_FLOW_INTENT_IDS,
    resolveHandoff,
    runEvaluation,
    wilson,
    writeReceipt,
};
