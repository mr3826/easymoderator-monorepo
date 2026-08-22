'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('../../src/modules/ai/contracts/action.contract');
const {
    INTENTS,
    INTENT_EVALUATION_CLASSES,
} = require('../../src/modules/ai/contracts/intent.contract');
const { withEvidenceSnapshot } = require('../../src/modules/ai/contracts/evidence.contract');
const { evaluateReadAction } = require('../../src/modules/ai/action-gate/read-action-evaluator');
const { classify } = require('../../src/modules/ai/intent/stage2-rules');
const {
    CORPUS,
    CORPUS_STATUS,
    CORPUS_VERSION,
    DECLARED_MINIMUMS,
} = require('../bd-eval/corpus');
const {
    PURCHASE_FLOW_INTENT_IDS,
    resolveHandoff,
    runEvaluation,
} = require('../bd-eval/run-eval');

const receiptPath = path.resolve(__dirname, '../../../docs/ai/evidence/bd-eval-receipt.json');

describe('Bangladesh AI seed evaluation receipt', () => {
    test('declares a regression-sized seed corpus without claiming launch scale', () => {
        expect(CORPUS_STATUS).toBe('SEED');
        expect(CORPUS.length).toBeGreaterThanOrEqual(DECLARED_MINIMUMS.labelledFixtures);
        expect(CORPUS.length).toBeLessThanOrEqual(300);
        expect(new Set(CORPUS.map(fixture => fixture.shopProfile)).size).toBeGreaterThanOrEqual(DECLARED_MINIMUMS.shops);
        expect(new Set(CORPUS.map(fixture => fixture.locale)).size).toBe(DECLARED_MINIMUMS.locales);
        const activeIds = Object.entries(INTENTS)
            .filter(([, definition]) => definition.status === 'ACTIVE'
                && definition.evaluationClass !== INTENT_EVALUATION_CLASSES.RUNTIME_OUTCOME)
            .map(([intentId]) => intentId);
        for (const intentId of activeIds) {
            expect(CORPUS.filter(fixture => fixture.expectedIntent === intentId).length).toBeGreaterThanOrEqual(10);
        }
    });

    test('contains the normative boundary phrases and a y confirmation near-miss', () => {
        const texts = CORPUS.flatMap(fixture => fixture.turns.map(turn => turn.text));
        expect(texts).toContain('ঢাকার বাইরে কত?');
        expect(texts).toContain('হ্যাঁ না');
        expect(texts).toContain('na hoile');
        expect(CORPUS.some(fixture => fixture.safetyTags.includes('CONFIRMATION_NEAR_MISS')
            && fixture.turns.some(turn => /y/i.test(turn.text))
            && fixture.expectedIntent !== 'ORDER_SESSION_CHECKOUT')).toBe(true);
    });

    test('two evaluation runs produce an identical receipt hash', () => {
        expect(runEvaluation().receiptHash).toBe(runEvaluation().receiptHash);
    });

    test('a correctly classified order lookup denied by the read gate counts as a handoff', () => {
        const fixture = CORPUS.find(record => record.expectedIntent === 'ORDER_STATUS_LOOKUP');
        const prediction = classify(fixture.turns[0].text, { language: 'en' });
        expect(prediction.intentId).toBe(fixture.expectedIntent);

        const readAction = evaluateReadAction({
            actionType: 'READ_ORDER_STATUS',
            tenant: {
                shopId: fixture.shopProfile,
                conversationId: fixture.fixtureId,
                customerId: null,
            },
            traceId: `bd-seed:${fixture.fixtureId}`,
            evidenceSnapshot: withEvidenceSnapshot({
                shopId: fixture.shopProfile,
                conversationId: fixture.fixtureId,
                sourceText: fixture.turns[0].text,
            }),
            payload: { orderNumber: prediction.slots.orderReference },
        });

        expect(readAction).toEqual({ recorded: false, reasonCode: 'customer_identity_unbound' });
        expect(resolveHandoff({
            prediction,
            readAction,
            runtimeSignals: { groundingFailure: false, confidenceFailure: false },
        }).resolved).toBe(true);

        const boundEvidence = withEvidenceSnapshot({
            shopId: fixture.shopProfile,
            conversationId: fixture.fixtureId,
            customerId: 'customer-1',
            sourceText: fixture.turns[0].text,
        });
        const boundRead = evaluateReadAction({
            actionType: 'READ_ORDER_STATUS',
            tenant: {
                shopId: fixture.shopProfile,
                conversationId: fixture.fixtureId,
                customerId: 'customer-1',
            },
            traceId: `bd-seed:bound:${fixture.fixtureId}`,
            evidenceSnapshot: boundEvidence,
            payload: { orderNumber: prediction.slots.orderReference },
        });
        expect(boundRead.recorded).toBe(true);
        expect(resolveHandoff({ prediction, readAction: boundRead }).resolved).toBe(false);
        expect(resolveHandoff({
            prediction: { intentId: 'PRODUCT_INQUIRY' },
            readAction: { recorded: false, reasonCode: 'tenant_scope_mismatch' },
        }).resolved).toBe(true);
    });

    test('exempts runtime outcome classes and records the reasons in the receipt', () => {
        const receipt = runEvaluation();
        const expectedIntentDenominator = CORPUS.filter((fixture) => (
            INTENTS[fixture.expectedIntent].evaluationClass !== INTENT_EVALUATION_CLASSES.RUNTIME_OUTCOME
        )).length;

        expect(receipt.perClassAccuracy).not.toHaveProperty('GENERAL_CHAT_OR_UNKNOWN');
        expect(receipt.perClassAccuracy).not.toHaveProperty('LOW_CONFIDENCE_OR_GROUNDING_FAILURE');
        expect(receipt.denominators.intent).toBe(expectedIntentDenominator);
        expect(receipt.evaluationExemptions.intentClasses).toEqual(expect.objectContaining({
            GENERAL_CHAT_OR_UNKNOWN: expect.objectContaining({
                evaluationClass: INTENT_EVALUATION_CLASSES.RUNTIME_OUTCOME,
            }),
            LOW_CONFIDENCE_OR_GROUNDING_FAILURE: expect.objectContaining({
                evaluationClass: INTENT_EVALUATION_CLASSES.RUNTIME_OUTCOME,
            }),
        }));
        expect(resolveHandoff({
            prediction: { intentId: 'PRODUCT_INQUIRY' },
            runtimeSignals: { groundingFailure: true },
        }).resolved).toBe(true);
        expect(receipt.runtimeScenarioCoverage.metric.value).toBe(1);
        expect(receipt.handoffResolution.runtimeFailureSignals).toEqual(['grounding_failure', 'confidence_hold']);
        const localeIntentDenominator = Object.values(receipt.localeSlices)
            .reduce((sum, slice) => sum + slice.intentAccuracy.denominator, 0);
        const shopIntentDenominator = Object.values(receipt.shopSlices)
            .reduce((sum, slice) => sum + slice.intentAccuracy.denominator, 0);
        expect(localeIntentDenominator).toBe(receipt.denominators.intent);
        expect(shopIntentDenominator).toBe(receipt.denominators.intent);
        expect(receipt.falsePurchaseStarts.denominator).toBe(CORPUS.filter(fixture => (
            !PURCHASE_FLOW_INTENT_IDS.includes(fixture.expectedIntent)
        )).length);
        expect(receipt.purchaseFlowFalseStarts.denominator).toBe(CORPUS.filter(fixture => (
            PURCHASE_FLOW_INTENT_IDS.includes(fixture.expectedIntent)
            && fixture.expectedIntent !== 'PURCHASE_INTENT_START'
        )).length);
        expect(receipt.mutationGateEvaluation.actions).toEqual(expect.objectContaining({
            CREATE_ORDER: expect.objectContaining({ candidates: expect.any(Number), unsafe: 0 }),
            EDIT_PREORDER_CART: expect.objectContaining({ candidates: expect.any(Number), unsafe: 0 }),
            CANCEL_ORDER_SESSION: expect.objectContaining({ candidates: expect.any(Number), unsafe: 0 }),
        }));
        expect(receipt.mutationGateEvaluation.policy).toBe('SHADOW_GATE_ONLY_NO_MUTATION');
        expect(receipt.mutationBoundaryScenarios.allDenied).toBe(true);
        expect(receipt.mutationBoundaryScenarios.scenarios).toHaveLength(5);
    });

    test('committed receipt is content-hash valid and remains unsigned', () => {
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        const { receiptHash, ...withoutHash } = receipt;
        const expectedHash = `sha256:${require('crypto').createHash('sha256')
            .update(canonicalJson(withoutHash), 'utf8')
            .digest('hex')}`;
        expect(receipt.corpusStatus).toBe(CORPUS_STATUS);
        expect(receipt.corpusVersion).toBe(CORPUS_VERSION);
        expect(receiptHash).toBe(expectedHash);
        expect(receipt.signedBy).toEqual([]);
        expect(receipt).toEqual(runEvaluation());
    });

    test('hard safety assertions pass while accuracy floors remain reported measurements', () => {
        const receipt = runEvaluation();
        expect(receipt.falseOrderCreations.successes).toBe(0);
        expect(receipt.unsafeShadowActions).toBe(0);
        expect(receipt.shadowMutationCandidates).toBeGreaterThan(0);
        expect(receipt.shadowMutationExecutions).toBe(0);
        expect(receipt.negatedPurchaseSafety.value).toBe(1);
        expect(receipt.domainAccuracy.denominator).toBe(receipt.labelledTurns);
        expect(receipt.intentMacroAccuracy).not.toBeNull();
        expect(receipt.slotAccuracy.denominator).toBeGreaterThan(0);
        expect(receipt.providerFallbackRate).toBeNull();
        expect(receipt.providerFallbackDenominator).toBe(0);
    });
});
