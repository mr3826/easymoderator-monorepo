'use strict';

const { assessRealGeminiQuality, independentVerificationMatches, matchesCurrentVerificationCommit, privacyScanPassed, renderMarkdown } = require('./generate-product-engine-v1-3-proof');

describe('paid Gemini quality readiness gate', () => {
    const validComparison = { comparisonValid: true };
    const expectedDenominators = { eligibleFactSlots: 18, answerableProductTurns: 15 };

    test('passes only when every candidate quality metric is measured and zero', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            contextResolutionFailures: 0,
            unsafeCrossDomainHandoffs: 0,
            verifiedCorrectAnswers: 18,
            eligibleFactSlots: 18,
            evaluatedFactSlots: 18,
            verifiedCorrectTurns: 15,
            evaluatedAnswerableProductTurns: 15,
        }, expectedDenominators)).toEqual({ status: 'PASS', metricsAvailable: true, missingMetrics: [], failedMetrics: [] });
    });

    test('fails on measured paid-run context or handoff failures', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            contextResolutionFailures: 3,
            unsafeCrossDomainHandoffs: 1,
            verifiedCorrectAnswers: 16,
            eligibleFactSlots: 18,
            evaluatedFactSlots: 18,
            verifiedCorrectTurns: 13,
            evaluatedAnswerableProductTurns: 15,
        }, expectedDenominators)).toEqual({ status: 'FAIL', metricsAvailable: true, missingMetrics: [], failedMetrics: ['contextResolutionFailures', 'unsafeCrossDomainHandoffs', 'factSlotCoverage', 'turnCoverage'] });
    });

    test('keeps missing quality metrics blocked instead of passing', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
        })).toEqual({ status: 'NOT_MEASURED', metricsAvailable: false, missingMetrics: [
            'contextResolutionFailures', 'unsafeCrossDomainHandoffs', 'verifiedCorrectAnswers', 'eligibleFactSlots',
            'evaluatedFactSlots', 'verifiedCorrectTurns', 'evaluatedAnswerableProductTurns',
        ], failedMetrics: [] });
    });

    test('fails on paid-run incomplete fact or answerable-turn coverage', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            contextResolutionFailures: 0,
            unsafeCrossDomainHandoffs: 0,
            verifiedCorrectAnswers: 17,
            eligibleFactSlots: 18,
            evaluatedFactSlots: 18,
            verifiedCorrectTurns: 15,
            evaluatedAnswerableProductTurns: 15,
        }, expectedDenominators).failedMetrics).toEqual(['factSlotCoverage']);
    });

    test('fails a structurally valid but empty benchmark denominator', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            contextResolutionFailures: 0,
            unsafeCrossDomainHandoffs: 0,
            verifiedCorrectAnswers: 0,
            eligibleFactSlots: 0,
            evaluatedFactSlots: 0,
            verifiedCorrectTurns: 0,
            evaluatedAnswerableProductTurns: 0,
        }).failedMetrics).toEqual(['nonEmptyDenominators']);
    });
});

describe('artifact privacy status mapping', () => {
    test('uses the scanner report privacyGateStatus field', () => {
        expect(privacyScanPassed({ privacyGateStatus: 'PASS' })).toBe(true);
        expect(privacyScanPassed({ privacyGateStatus: 'FAIL' })).toBe(false);
        expect(privacyScanPassed({ status: 'PASS' })).toBe(false);
    });
});

describe('V1.3 proof Markdown rendering', () => {
    const proof = {
        generatedAt: '2026-10-22T00:00:00.000Z',
        candidate: { worktree: 'isolated', backendSourceSha256: 'a'.repeat(64), cleanAtVerificationStart: true },
        benchmark: { eligibleFactSlots: 18, sourceCorpusSha256: 'b'.repeat(64) },
        measured: { estimatedCostPerCandidateVerifiedAnswerUsd: null },
        security: { egress: { guard: 'PASS', blockedNonLoopbackAttempts: 0 } },
    };
    const status = {
        AUTOMATED_QA_VERDICT: 'BLOCKED',
        INTEGRATION_READY: 'NO',
        CUSTOMER_TRUTH_VERDICT: 'PASS',
        COMMERCIAL_EVIDENCE_VERDICT: 'NOT_ESTABLISHED',
    };

    test('renders an offline report when no real Gemini comparison exists', () => {
        const markdown = renderMarkdown(proof, status, [], {}, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: null,
        });

        expect(markdown).toContain('Estimated matched-pair provider cost from priced usage: NOT_RUN.');
        expect(markdown).toContain('Candidate unpriced provider calls: NOT_RUN.');
        expect(markdown).toContain('Real Gemini vision evaluation: NOT_RUN.');
    });

    test('uses the recorded paid comparison for matched-pair cost', () => {
        const markdown = renderMarkdown(proof, status, [], {
            realGemini: {
                model: 'gemini-3.1-flash-lite',
                textRequestsBothEngines: 8,
                visionRequestsBothEngines: 3,
                estimatedProviderChargeUsdBothEngines: 0.12345678,
            },
        }, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: { model: 'gemini-3.1-flash-lite' },
            realCandidate: { verifiedCorrectAnswers: 4, unpricedProviderCalls: 1 },
            photosTested: 3,
            photoCategoryMatches: 2,
            photoColorMatches: 1,
        });

        expect(markdown).toContain('Estimated matched-pair provider cost from priced usage: $0.12345678.');
        expect(markdown).toContain('Candidate unpriced provider calls: 1.');
        expect(markdown).toContain('candidate estimate may be incomplete.');
    });
});

describe('current verification receipt selection', () => {
    test('does not reuse a failed receipt from an older commit with the same backend source hash', () => {
        const oldReceipt = {
            candidateCommit: 'old-commit',
            candidateBackendSourceSha256: 'a'.repeat(64),
            status: 'FAIL',
        };

        expect(matchesCurrentVerificationCommit(oldReceipt, 'current-commit')).toBe(false);
        expect(matchesCurrentVerificationCommit({ ...oldReceipt, candidateCommit: 'current-commit' }, 'current-commit')).toBe(true);
    });

    test('requires independent review of the current evidence head and backend source', () => {
        const review = {
            verdict: 'PASS',
            reviewedCodeCommit: 'current-head',
            reviewedBackendSourceSha256: 'a'.repeat(64),
        };

        expect(independentVerificationMatches(review, 'current-head', 'a'.repeat(64))).toBe(true);
        expect(independentVerificationMatches(review, 'tested-code-head', 'a'.repeat(64))).toBe(false);
        expect(independentVerificationMatches(review, 'current-head', 'b'.repeat(64))).toBe(false);
    });
});
