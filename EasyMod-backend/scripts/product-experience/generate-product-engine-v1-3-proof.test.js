'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assessRealGeminiQuality, calculateCandidateCostMetrics, independentVerificationMatches, independentVerificationStatus, matchesCurrentVerificationCommit, newestMatching, privacyScanPassed, renderMarkdown, summarizeRunLedger } = require('./generate-product-engine-v1-3-proof');

describe('evidence artifact selection', () => {
    test('uses file modification time for receipts without a recorded timestamp', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v13-evidence-order-'));
        try {
            const older = path.join(directory, 'older.json');
            const newer = path.join(directory, 'newer.json');
            fs.writeFileSync(older, JSON.stringify({ kind: 'comparison' }));
            fs.writeFileSync(newer, JSON.stringify({ kind: 'comparison' }));
            fs.utimesSync(older, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'));
            fs.utimesSync(newer, new Date('2021-01-01T00:00:00.000Z'), new Date('2021-01-01T00:00:00.000Z'));

            expect(path.basename(newestMatching(directory, item => item.kind === 'comparison').filename)).toBe('newer.json');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe('paid Gemini quality readiness gate', () => {
    const validComparison = { comparisonValid: true };
    const expectedDenominators = {
        eligibleFactSlots: 18, answerableProductTurns: 15,
        falseRefusalExpectedTurns: 15,
        contextDependentAnswerableTurns: 2, crossDomainHandoffTurns: 2,
    };

    test('passes only when every candidate quality metric is measured and zero', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            falseRefusalExpectedTurns: 15,
            falseRefusalEvaluatedTurns: 15,
            contextResolutionFailures: 0,
            unsafeCrossDomainHandoffs: 0,
            verifiedCorrectAnswers: 18,
            eligibleFactSlots: 18,
            evaluatedFactSlots: 18,
            verifiedCorrectTurns: 15,
            evaluatedAnswerableProductTurns: 15,
            contextDependentAnswerableTurns: 2,
            evaluatedContextDependentAnswerableTurns: 2,
            crossDomainHandoffTurns: 2,
            evaluatedCrossDomainHandoffTurns: 2,
        }, expectedDenominators)).toEqual({ status: 'PASS', metricsAvailable: true, missingMetrics: [], failedMetrics: [] });
    });

    test('fails on measured paid-run context or handoff failures', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            falseRefusalExpectedTurns: 15,
            falseRefusalEvaluatedTurns: 15,
            contextResolutionFailures: 3,
            unsafeCrossDomainHandoffs: 1,
            verifiedCorrectAnswers: 16,
            eligibleFactSlots: 18,
            evaluatedFactSlots: 18,
            verifiedCorrectTurns: 13,
            evaluatedAnswerableProductTurns: 15,
            contextDependentAnswerableTurns: 2,
            evaluatedContextDependentAnswerableTurns: 2,
            crossDomainHandoffTurns: 2,
            evaluatedCrossDomainHandoffTurns: 2,
        }, expectedDenominators)).toEqual({ status: 'FAIL', metricsAvailable: true, missingMetrics: [], failedMetrics: ['contextResolutionFailures', 'unsafeCrossDomainHandoffs', 'factSlotCoverage', 'turnCoverage'] });
    });

    test('keeps missing quality metrics blocked instead of passing', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
        })).toEqual({ status: 'NOT_MEASURED', metricsAvailable: false, missingMetrics: [
            'contextResolutionFailures', 'unsafeCrossDomainHandoffs',
            'falseRefusalExpectedTurns', 'falseRefusalEvaluatedTurns',
            'verifiedCorrectAnswers', 'eligibleFactSlots',
            'evaluatedFactSlots', 'verifiedCorrectTurns', 'evaluatedAnswerableProductTurns',
            'contextDependentAnswerableTurns', 'evaluatedContextDependentAnswerableTurns',
            'crossDomainHandoffTurns', 'evaluatedCrossDomainHandoffTurns',
        ], failedMetrics: [] });
    });

    test('fails on paid-run incomplete fact or answerable-turn coverage', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            falseRefusalExpectedTurns: 15,
            falseRefusalEvaluatedTurns: 15,
            contextResolutionFailures: 0,
            unsafeCrossDomainHandoffs: 0,
            verifiedCorrectAnswers: 17,
            eligibleFactSlots: 18,
            evaluatedFactSlots: 18,
            verifiedCorrectTurns: 15,
            evaluatedAnswerableProductTurns: 15,
            contextDependentAnswerableTurns: 2,
            evaluatedContextDependentAnswerableTurns: 2,
            crossDomainHandoffTurns: 2,
            evaluatedCrossDomainHandoffTurns: 2,
        }, expectedDenominators).failedMetrics).toEqual(['factSlotCoverage']);
    });

    test('fails a structurally valid but empty benchmark denominator', () => {
        expect(assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            falseRefusalExpectedTurns: 0,
            falseRefusalEvaluatedTurns: 0,
            contextResolutionFailures: 0,
            unsafeCrossDomainHandoffs: 0,
            verifiedCorrectAnswers: 0,
            eligibleFactSlots: 0,
            evaluatedFactSlots: 0,
            verifiedCorrectTurns: 0,
            evaluatedAnswerableProductTurns: 0,
            contextDependentAnswerableTurns: 2,
            evaluatedContextDependentAnswerableTurns: 2,
            crossDomainHandoffTurns: 2,
            evaluatedCrossDomainHandoffTurns: 2,
        }).failedMetrics).toEqual(['nonEmptyDenominators']);
    });

    test('fails when the paid route leaves context or handoff turns unexecuted', () => {
        const result = assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            falseRefusalExpectedTurns: 15,
            falseRefusalEvaluatedTurns: 15,
            contextResolutionFailures: 0,
            unsafeCrossDomainHandoffs: 0,
            verifiedCorrectAnswers: 18,
            eligibleFactSlots: 18,
            evaluatedFactSlots: 18,
            verifiedCorrectTurns: 15,
            evaluatedAnswerableProductTurns: 15,
            contextDependentAnswerableTurns: 2,
            evaluatedContextDependentAnswerableTurns: 1,
            crossDomainHandoffTurns: 2,
            evaluatedCrossDomainHandoffTurns: 1,
        }, expectedDenominators);

        expect(result.status).toBe('FAIL');
        expect(result.failedMetrics).toEqual(['contextTurnCoverage', 'crossDomainHandoffCoverage']);
    });

    test('fails when expected false-refusal turns were not evaluable', () => {
        const result = assessRealGeminiQuality(validComparison, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
            falseRefusalExpectedTurns: 15,
            falseRefusalEvaluatedTurns: 13,
            contextResolutionFailures: 0,
            unsafeCrossDomainHandoffs: 0,
            verifiedCorrectAnswers: 18,
            eligibleFactSlots: 18,
            evaluatedFactSlots: 18,
            verifiedCorrectTurns: 15,
            evaluatedAnswerableProductTurns: 15,
            contextDependentAnswerableTurns: 2,
            evaluatedContextDependentAnswerableTurns: 2,
            crossDomainHandoffTurns: 2,
            evaluatedCrossDomainHandoffTurns: 2,
        }, expectedDenominators);

        expect(result.status).toBe('FAIL');
        expect(result.failedMetrics).toEqual(['falseRefusalCoverage']);
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
        candidate: { worktree: 'isolated', evidenceRoot: 'D:\\evidence', backendSourceSha256: 'a'.repeat(64), cleanAtVerificationStart: true },
        benchmark: { eligibleFactSlots: 18, sourceCorpusSha256: 'b'.repeat(64) },
        measured: { estimatedCostPerCandidateVerifiedAnswerUsd: null },
        security: { egress: { guard: 'PASS', blockedNonLoopbackAttempts: 0 }, privacyScan: { checkedAt: '2026-10-22T00:00:00Z' } },
    };
    const status = {
        AUTOMATED_QA_VERDICT: 'BLOCKED',
        INTEGRATION_READY: 'NO',
        DETERMINISTIC_SOURCE_TRUTH_VERDICT: 'PASS',
        REAL_GEMINI_QUALITY_VERDICT: 'FAIL',
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
        expect(markdown).toContain('Deterministic source truth (zero provider calls) | PASS');
        expect(markdown).toContain('Real Gemini candidate quality | FAIL');
        expect(markdown).toContain('Evidence package root: `D:\\evidence`');
        expect(markdown).toContain('Pre-proof artifact privacy scan');
        expect(markdown).toContain('Unsupported price claims with SEND disposition');
        expect(markdown).toContain('This verdict covers the zero-provider-call replay against the source oracle only.');
    });

    test('documents the assistant-grounded context rule for false-refusal scoring', () => {
        const markdown = renderMarkdown(proof, status, [], {}, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: null,
        });

        expect(markdown).toContain('Context-dependent false refusals are evaluated only when every earlier turn in that conversation executed and an earlier assistant turn had a SEND disposition for a non-refusal reply with a contract-valid READY presentation grounding the same product.');
        expect(markdown).toContain('This is approved replay output; actual Messenger delivery is not established.');
        expect(markdown).toContain('An intervening product `NOT_FOUND` clears that active context; expected turns without a complete grounding chain remain not evaluable.');
    });

    test('calculates cost per verified answer turn separately from cost per verified fact slot', () => {
        expect(calculateCandidateCostMetrics(true, {
            estimatedProviderChargeUsd: 0.014899,
            verifiedCorrectTurns: 13,
            verifiedCorrectAnswers: 16,
        })).toEqual({
            estimatedCostPerCandidateVerifiedAnswerUsd: 0.014899 / 13,
            estimatedCostPerCandidateVerifiedFactSlotUsd: 0.014899 / 16,
        });
        expect(calculateCandidateCostMetrics(true, {
            estimatedProviderChargeUsd: 0.014899,
            verifiedCorrectTurns: 0,
            verifiedCorrectAnswers: 16,
        })).toEqual({
            estimatedCostPerCandidateVerifiedAnswerUsd: null,
            estimatedCostPerCandidateVerifiedFactSlotUsd: 0.014899 / 16,
        });
    });

    test('counts unpriced provider usage separately from rejected campaign reservations', () => {
        expect(summarizeRunLedger({ snapshot: { calls: [
            { status: 'provider_reported', estimatedProviderChargeUsd: 0.01 },
            { status: 'campaign_ledger_rejected', estimatedProviderChargeUsd: null },
        ] } })).toEqual({
            providerUsageRecords: 1,
            requestAttempts: 2,
            providerTextCalls: 1,
            providerVisionCalls: 0,
            textRequestAttempts: 2,
            visionRequestAttempts: 0,
            unpricedProviderCalls: 0,
            campaignRejectedAttempts: 1,
        });
        expect(summarizeRunLedger({ snapshot: { calls: [
            { status: 'provider_reported', estimatedProviderChargeUsd: null },
            { status: 'campaign_ledger_rejected', estimatedProviderChargeUsd: null },
        ] } })).toEqual({
            providerUsageRecords: 1,
            requestAttempts: 2,
            providerTextCalls: 1,
            providerVisionCalls: 0,
            textRequestAttempts: 2,
            visionRequestAttempts: 0,
            unpricedProviderCalls: 1,
            campaignRejectedAttempts: 1,
        });
        expect(summarizeRunLedger(null)).toEqual({
            providerUsageRecords: null,
            requestAttempts: null,
            providerTextCalls: null,
            providerVisionCalls: null,
            textRequestAttempts: null,
            visionRequestAttempts: null,
            unpricedProviderCalls: null,
            campaignRejectedAttempts: null,
        });
    });

    test('reports provider-reported text and vision calls separately from rejected attempts', () => {
        expect(summarizeRunLedger({ snapshot: { calls: [
            { status: 'provider_reported', vision: true, estimatedProviderChargeUsd: 0.02 },
            { status: 'campaign_ledger_rejected', vision: true, estimatedProviderChargeUsd: null },
        ] } })).toEqual({
            providerUsageRecords: 1,
            requestAttempts: 2,
            providerTextCalls: 0,
            providerVisionCalls: 1,
            textRequestAttempts: 0,
            visionRequestAttempts: 2,
            unpricedProviderCalls: 0,
            campaignRejectedAttempts: 1,
        });
    });

    test('renders the integration receipt path from the selected evidence package', () => {
        const markdown = renderMarkdown(proof, status, [], {}, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: null,
        });

        expect(markdown).toContain('Disposable service receipts: `D:\\evidence\\integration`.');
        expect(markdown).not.toContain('[artifacts/integration](artifacts/integration/)');
    });

    test('uses the recorded paid comparison for matched-pair cost', () => {
        const costProof = {
            ...proof,
            measured: {
                ...proof.measured,
                estimatedCostPerCandidateVerifiedAnswerUsd: 0.014899 / 13,
                estimatedCostPerCandidateVerifiedFactSlotUsd: 0.014899 / 16,
            },
        };
        const markdown = renderMarkdown(costProof, status, [], {
            realGemini: {
                model: 'gemini-3.1-flash-lite',
                providerTextCallsBothEngines: 7,
                providerVisionCallsBothEngines: 3,
                textRequestAttemptsBothEngines: 8,
                visionRequestAttemptsBothEngines: 3,
                estimatedProviderChargeUsdBothEngines: 0.12345678,
            },
        }, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: { model: 'gemini-3.1-flash-lite' },
            realCandidate: {
                verifiedCorrectAnswers: 16,
                verifiedCorrectTurns: 13,
                estimatedProviderChargeUsd: 0.014899,
                requestAttempts: 74,
                providerUsageRecords: 73,
                unpricedProviderCalls: 0,
                campaignRejectedAttempts: 1,
            },
            photosTested: 3,
            photoCategoryMatches: 2,
            photoColorMatches: 1,
        });

        expect(markdown).toContain('Estimated matched-pair provider cost from priced usage: $0.12345678.');
        expect(markdown).toContain('Provider-reported traffic across matched arms: 7 text and 3 vision calls.');
        expect(markdown).toContain('Request attempts across matched arms: 8 text and 3 vision.');
        expect(markdown).toContain('Candidate unpriced provider calls: 0.');
        expect(markdown).toContain('Rejected campaign ledger attempts: 1 (blocked before provider usage).');
        expect(markdown).toContain('Candidate run ledger: 74 request attempts, 73 provider usage records, 1 rejected reservation.');
        expect(markdown).toContain('Candidate cost per verified product-answer turn: $0.00114608; per verified fact slot: $0.00093119.');
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
            reviewedRunnerSourceSha256: 'c'.repeat(64),
        };

        expect(independentVerificationMatches(review, 'current-head', 'a'.repeat(64), 'c'.repeat(64))).toBe(true);
        expect(independentVerificationMatches(review, 'tested-code-head', 'a'.repeat(64), 'c'.repeat(64))).toBe(false);
        expect(independentVerificationMatches(review, 'current-head', 'b'.repeat(64), 'c'.repeat(64))).toBe(false);
        expect(independentVerificationMatches(review, 'current-head', 'a'.repeat(64), 'd'.repeat(64))).toBe(false);
    });

    test('distinguishes failed and blocked current reviews from stale or missing reviews', () => {
        const review = {
            reviewedCodeCommit: 'current-head',
            reviewedBackendSourceSha256: 'a'.repeat(64),
            reviewedRunnerSourceSha256: 'c'.repeat(64),
        };

        expect(independentVerificationStatus(null, 'current-head', 'a'.repeat(64), 'c'.repeat(64))).toBe('NOT_RUN');
        expect(independentVerificationStatus({ ...review, verdict: 'FAIL' }, 'current-head', 'a'.repeat(64), 'c'.repeat(64))).toBe('FAIL');
        expect(independentVerificationStatus({ ...review, verdict: 'BLOCKED' }, 'current-head', 'a'.repeat(64), 'c'.repeat(64))).toBe('BLOCKED');
        expect(independentVerificationStatus({ ...review, verdict: 'PASS' }, 'old-head', 'a'.repeat(64), 'c'.repeat(64))).toBe('STALE');
    });
});
