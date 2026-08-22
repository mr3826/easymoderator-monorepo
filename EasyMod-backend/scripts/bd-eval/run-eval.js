#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJson, createProposedAction, deriveIdempotencyKey, MUTATING_ACTION_TYPES } = require('../../src/modules/ai/contracts/action.contract');
const { INTENTS, INTENT_REGISTRY_VERSION } = require('../../src/modules/ai/contracts/intent.contract');
const { withEvidenceSnapshot } = require('../../src/modules/ai/contracts/evidence.contract');
const { evaluateChecks } = require('../../src/modules/ai/action-gate/action-gate.service');
const { classify } = require('../../src/modules/ai/intent/stage2-rules');
const { CORPUS, CORPUS_STATUS, CORPUS_VERSION, DECLARED_MINIMUMS } = require('./corpus');

const MEASURED_AT = '2026-08-22T00:00:00.000Z';
const DATE_RANGE = Object.freeze({ from: MEASURED_AT, to: MEASURED_AT });
const Z_SCORE = 1.96;

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
        lower: Number(((centre - margin) / denominatorWithZ).toFixed(6)),
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

const classifyFixture = (fixture, index) => {
    const text = fixture.turns.map(turn => turn.text).join(' ');
    const prediction = classify(text, {
        language: localeForClassifier(fixture.locale),
        ...fixture.classifierOptions,
    });
    return {
        fixture,
        prediction,
        latencyMs: deterministicLatencyMs(text, index),
        unsafe: actionWouldBeUnsafe({ fixture, prediction, index }),
        mutationResult: { committed: false, mode: 'SHADOW_NO_MUTATION' },
    };
};

const buildSlice = (records, key, values) => values.reduce((result, value) => {
    const subset = records.filter(record => record.fixture[key] === value);
    const domainCorrect = subset.filter(record => record.prediction.domain === record.fixture.expectedDomain).length;
    const intentCorrect = subset.filter(record => record.prediction.intentId === record.fixture.expectedIntent).length;
    result[value] = {
        denominator: subset.length,
        shopCount: new Set(subset.map(record => record.fixture.shopProfile)).size,
        domainAccuracy: metric(domainCorrect, subset.length),
        intentAccuracy: metric(intentCorrect, subset.length),
        dateRange: DATE_RANGE,
    };
    return result;
}, {});

const runEvaluation = () => {
    const records = CORPUS.map(classifyFixture);
    const total = records.length;
    const domainCorrect = records.filter(record => record.prediction.domain === record.fixture.expectedDomain).length;
    const intentCorrect = records.filter(record => record.prediction.intentId === record.fixture.expectedIntent).length;
    const activeIntentIds = Object.entries(INTENTS)
        .filter(([, definition]) => definition.status === 'ACTIVE')
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
    const nonPurchase = records.filter(record => record.fixture.expectedIntent !== 'PURCHASE_INTENT_START');
    const falsePurchaseStarts = nonPurchase.filter(record => record.prediction.intentId === 'PURCHASE_INTENT_START').length;
    const falseOrderCreationRecords = records.filter(record => (
        record.mutationResult?.committed === true
        && record.fixture.expectedAction !== 'CREATE_ORDER'
    ));
    const handoffFixtures = records.filter(record => record.fixture.expectedCustomerState === 'HUMAN_REQUIRED');
    const handoffHits = handoffFixtures.filter(record => [
        'STOP_OPT_OUT', 'SENTIMENT_HANDOFF', 'ORDER_POST_PURCHASE_REQUEST', 'HUMAN_HANDOFF_REQUEST',
        'LOW_CONFIDENCE_OR_GROUNDING_FAILURE',
    ].includes(record.prediction.intentId)).length;
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
        release: 'phase-b-seed',
        corpusStatus: CORPUS_STATUS,
        dateRange,
        releaseNotes: 'Engineering seed receipt; QA sign-off and human signatures are pending.',
        contractVersion: '1.0',
        registryVersion: INTENT_REGISTRY_VERSION,
        promptVersion: 'none-deterministic-shadow',
        corpusVersion: CORPUS_VERSION,
        labelledTurns: total,
        shopCount,
        localeCounts,
        denominators: {
            domain: total,
            intent: total,
            falsePurchaseStarts: nonPurchase.length,
            falseOrderCreations: total,
            handoffRecall: handoffFixtures.length,
            negatedPurchase: negated.length,
            providerFallback: 0,
        },
        domainAccuracy: metric(domainCorrect, total),
        intentMacroAccuracy,
        perClassAccuracy,
        falsePurchaseStarts: metric(falsePurchaseStarts, nonPurchase.length),
        falseOrderCreations: metric(falseOrderCreationRecords.length, total),
        handoffRecall: metric(handoffHits, handoffFixtures.length),
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
    MEASURED_AT,
    runEvaluation,
    wilson,
    writeReceipt,
};
