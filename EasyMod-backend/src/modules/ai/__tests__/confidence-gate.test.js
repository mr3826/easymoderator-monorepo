'use strict';

/**
 * confidence-gate.service — decides whether an auto-generated reply should be
 * HELD for a human (low confidence) instead of being delivered to the customer.
 */

process.env.NODE_ENV = 'test';

const {
    shouldHoldForLowConfidence,
    normalizeThreshold,
    normalizeConfidence,
} = require('src/modules/ai/confidence-gate.service');

describe('normalizeThreshold', () => {
    test('passes through a 0–1 fraction unchanged', () => {
        expect(normalizeThreshold(0.6)).toBeCloseTo(0.6);
    });
    test('converts a 0–100 percentage to a fraction', () => {
        expect(normalizeThreshold(75)).toBeCloseTo(0.75);
    });
    test('falls back to default 0.75 when disabled / missing / invalid', () => {
        expect(normalizeThreshold(null)).toBeCloseTo(0.75);
        expect(normalizeThreshold(undefined)).toBeCloseTo(0.75);
        expect(normalizeThreshold('nonsense')).toBeCloseTo(0.75);
    });
});

describe('normalizeConfidence', () => {
    test('passes through a 0–1 fraction', () => {
        expect(normalizeConfidence(0.42)).toBeCloseTo(0.42);
    });
    test('converts a 0–100 score to a fraction', () => {
        expect(normalizeConfidence(80)).toBeCloseTo(0.8);
    });
    test('returns null for missing confidence', () => {
        expect(normalizeConfidence(null)).toBeNull();
        expect(normalizeConfidence(undefined)).toBeNull();
    });
});

describe('shouldHoldForLowConfidence', () => {
    test('holds when confidence is below the per-shop threshold in auto mode', () => {
        expect(shouldHoldForLowConfidence({
            confidence: 0.4, automationMode: 'AI_ACTIVE', confidenceThreshold: 75,
        })).toBe(true);
    });

    test('does NOT hold when confidence is at or above the threshold', () => {
        expect(shouldHoldForLowConfidence({
            confidence: 0.75, automationMode: 'AI_ACTIVE', confidenceThreshold: 75,
        })).toBe(false);
        expect(shouldHoldForLowConfidence({
            confidence: 0.9, automationMode: 'AI_ACTIVE', confidenceThreshold: 75,
        })).toBe(false);
    });

    test('threshold boundary: 0.74 holds, 0.75 sends (threshold 75)', () => {
        expect(shouldHoldForLowConfidence({ confidence: 0.74, confidenceThreshold: 75 })).toBe(true);
        expect(shouldHoldForLowConfidence({ confidence: 0.75, confidenceThreshold: 75 })).toBe(false);
    });

    test('does NOT hold in non-auto modes (policy engine already withholds)', () => {
        for (const mode of ['DRAFT', 'AI_SUGGEST_ONLY', 'HUMAN_ACTIVE', 'MANUAL']) {
            expect(shouldHoldForLowConfidence({
                confidence: 0.1, automationMode: mode, confidenceThreshold: 75,
            })).toBe(false);
        }
    });

    test('never holds a deterministic order-flow turn', () => {
        expect(shouldHoldForLowConfidence({
            confidence: 0.1, automationMode: 'AI_ACTIVE', confidenceThreshold: 75,
            orderFlowHandled: true,
        })).toBe(false);
    });

    test('treats null/undefined confidence as low → holds (AI pipeline failure)', () => {
        expect(shouldHoldForLowConfidence({ confidence: null, confidenceThreshold: 75 })).toBe(true);
        expect(shouldHoldForLowConfidence({ confidence: undefined, confidenceThreshold: 75 })).toBe(true);
    });

    test('uses the 0.75 default when the shop has no threshold configured', () => {
        expect(shouldHoldForLowConfidence({ confidence: 0.7 })).toBe(true);
        expect(shouldHoldForLowConfidence({ confidence: 0.8 })).toBe(false);
    });
});
