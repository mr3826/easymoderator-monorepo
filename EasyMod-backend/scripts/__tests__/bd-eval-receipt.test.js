'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('../../src/modules/ai/contracts/action.contract');
const { INTENTS } = require('../../src/modules/ai/contracts/intent.contract');
const {
    CORPUS,
    CORPUS_STATUS,
    CORPUS_VERSION,
    DECLARED_MINIMUMS,
} = require('../bd-eval/corpus');
const { runEvaluation } = require('../bd-eval/run-eval');

const receiptPath = path.resolve(__dirname, '../../../docs/ai/evidence/bd-eval-receipt.json');

describe('Bangladesh AI seed evaluation receipt', () => {
    test('declares a regression-sized seed corpus without claiming launch scale', () => {
        expect(CORPUS_STATUS).toBe('SEED');
        expect(CORPUS.length).toBeGreaterThanOrEqual(DECLARED_MINIMUMS.labelledFixtures);
        expect(CORPUS.length).toBeLessThanOrEqual(300);
        expect(new Set(CORPUS.map(fixture => fixture.shopProfile)).size).toBeGreaterThanOrEqual(DECLARED_MINIMUMS.shops);
        expect(new Set(CORPUS.map(fixture => fixture.locale)).size).toBe(DECLARED_MINIMUMS.locales);
        const activeIds = Object.entries(INTENTS)
            .filter(([, definition]) => definition.status === 'ACTIVE')
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
