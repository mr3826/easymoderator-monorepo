'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assessAutomatedQaVerdict, assessGenuinePhotoQuality, assessPlaywrightExecution, assessRealGeminiQuality, calculateCandidateCostMetrics, independentVerificationMatches, independentVerificationStatus, matchesCurrentVerificationCommit, newestMatching, privacyScanPassed, renderMarkdown, safeExamples, summarizeCampaignLedger, summarizeRunLedger } = require('./generate-product-engine-v1-3-proof');

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

describe('redacted customer examples', () => {
    test('re-scrubs contact data before returning source examples', () => {
        const [example] = safeExamples({ turns: [{
            scenarioId: 'scenario-safe-example',
            inputRedacted: 'What sizes are available? Call 01712345678 or email buyer@example.test.',
            finalReplyRedacted: 'I can check that. buyer@example.test',
            oracle: { textOnlyMetricEligible: true },
            factScores: { correctAnsweredSlots: 1 },
            evaluationStatus: 'EVALUATED',
            disposition: 'SEND',
        }] });

        expect(example.customerMessageRedacted).toBe('What sizes are available? Call [PHONE] or email [EMAIL].');
        expect(example.engineResponseRedacted).toBe('I can check that. [EMAIL]');
        expect(JSON.stringify(example)).not.toMatch(/01712345678|buyer@example\.test/);
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

    test('marks an incomplete Gemini comparison unmeasured while preserving comparison failure separately', () => {
        expect(assessRealGeminiQuality({ comparisonValid: false }, {
            unsupportedClaimsSent: 0,
            falseRefusalSlots: 0,
        })).toEqual({ status: 'NOT_MEASURED', metricsAvailable: false, missingMetrics: [], failedMetrics: [] });
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

describe('genuine photo acceptance gate', () => {
    const completeComparison = { comparisonValid: true };
    const photos = [
        { fixtureId: 'photo-a', fixtureSha256: 'a'.repeat(64), status: 'EXECUTED', categoryMatch: true, dominantColorMatch: true },
        { fixtureId: 'photo-b', fixtureSha256: 'b'.repeat(64), status: 'EXECUTED', categoryMatch: true, dominantColorMatch: true },
        { fixtureId: 'photo-c', fixtureSha256: 'c'.repeat(64), status: 'EXECUTED', categoryMatch: true, dominantColorMatch: true },
    ];

    test('passes only with three executed, distinct, checksum-backed photos and all category and color matches', () => {
        expect(assessGenuinePhotoQuality(completeComparison, photos, 3)).toEqual({
            status: 'PASS', photosTested: 3, categoryMatches: 3, colorMatches: 3,
            failedMetrics: [], missingMetrics: [],
        });
    });

    test('fails the measured photo gate when any category or color is wrong', () => {
        const result = assessGenuinePhotoQuality(completeComparison, [
            { ...photos[0], categoryMatch: false }, photos[1], photos[2],
        ], 3);
        expect(result).toEqual({
            status: 'FAIL', photosTested: 3, categoryMatches: 2, colorMatches: 3,
            failedMetrics: ['categoryAccuracy'], missingMetrics: [],
        });
    });

    test('leaves missing or incomplete photo evidence unmeasured', () => {
        expect(assessGenuinePhotoQuality(completeComparison, photos.slice(0, 2), 2)).toMatchObject({
            status: 'NOT_MEASURED', missingMetrics: expect.arrayContaining(['threePhotoSample']),
        });
        expect(assessGenuinePhotoQuality({ comparisonValid: false }, photos, 3).status).toBe('NOT_MEASURED');
        expect(assessGenuinePhotoQuality(null, [], null).status).toBe('NOT_RUN');
    });
});

describe('aggregate automated QA verdict', () => {
    test('fails measured photo acceptance errors even when other evidence passed', () => {
        expect(assessAutomatedQaVerdict({
            hasAutomatedFailure: false, sourceTruthMetricsAvailable: true, qualityPass: true,
            requiredEvidencePresent: true, automatedStepsPass: true, photoStatus: 'FAIL',
        })).toBe('FAIL');
    });

    test('blocks missing photo evidence instead of passing readiness', () => {
        expect(assessAutomatedQaVerdict({
            hasAutomatedFailure: false, sourceTruthMetricsAvailable: true, qualityPass: true,
            requiredEvidencePresent: true, automatedStepsPass: true, photoStatus: 'NOT_MEASURED',
        })).toBe('BLOCKED');
    });

    test('passes only when all ordinary and photo gates pass', () => {
        expect(assessAutomatedQaVerdict({
            hasAutomatedFailure: false, sourceTruthMetricsAvailable: true, qualityPass: true,
            requiredEvidencePresent: true, automatedStepsPass: true, photoStatus: 'PASS',
        })).toBe('PASS');
    });
});

describe('artifact privacy status mapping', () => {
    test('uses the scanner report privacyGateStatus field', () => {
        expect(privacyScanPassed({ privacyGateStatus: 'PASS' })).toBe(true);
        expect(privacyScanPassed({ privacyGateStatus: 'FAIL' })).toBe(false);
        expect(privacyScanPassed({ status: 'PASS' })).toBe(false);
    });
});

describe('Playwright evidence classification', () => {
    test('does not call a pre-journey process exit an assertion failure', () => {
        expect(assessPlaywrightExecution(null)).toBe('NOT_RUN');
        expect(assessPlaywrightExecution({ playwrightExitCode: 0, tests: { passed: 2, failed: 0 } })).toBe('PASS');
        expect(assessPlaywrightExecution({ playwrightExitCode: 4294967295, tests: {
            passed: 0, failed: 1, results: [{ status: 'failed', duration: '0ms' }],
        } })).toBe('INCOMPLETE');
        expect(assessPlaywrightExecution({ playwrightExitCode: 1, tests: {
            passed: 1, failed: 1, results: [{ status: 'failed', duration: '20ms' }],
        } })).toBe('FAIL');
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

    test('does not print literal source messages or replies in Markdown examples', () => {
        const sourceMessage = 'What is the size and price? Contact [PHONE].';
        const sourceReply = 'I can check the verified size and price for you.';
        const markdown = renderMarkdown(proof, status, [{
            scenarioId: 'scenario-privacy-check',
            label: 'Verified product answer',
            customerMessageRedacted: sourceMessage,
            engineResponseRedacted: sourceReply,
            disposition: 'SEND',
            correctAnsweredSlots: 1,
            eligibleSlots: 1,
        }], {}, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: null,
        });

        expect(markdown).toContain(`Customer message (redacted): ${sourceMessage}`);
        expect(markdown).toContain(`Engine response (redacted): ${sourceReply}`);
        expect(markdown).not.toContain('01712345678');
    });

    test('labels an invalid Gemini comparison as incomplete without claiming a matched photo result', () => {
        const markdown = renderMarkdown({
            ...proof,
            comparisons: { realGemini: { valid: false, model: 'gemini-test', observedPricedProviderChargeUsdAcrossIncompleteAttempts: 0.011893752,
                textRequestAttemptsBothEngines: 49, visionRequestAttemptsBothEngines: 6,
                campaignLedger: { requestAttempts: 55, baselineAttempts: 51, candidateAttempts: 4,
                    providerTextCalls: 48, providerVisionCalls: 6, unpricedOrPendingRequests: 1 } } },
            verificationEntryPoint: { status: 'IN_PROGRESS', complete: false, steps: [
                { name: 'postgres-redis-worker-webhook-and-full-backend-regression', status: 'FAIL', timedOut: true },
                { name: 'backend-security-suite', status: 'FAIL', timedOut: true },
            ] },
        }, {
            ...status,
            REAL_GEMINI_QUALITY_VERDICT: 'NOT_MEASURED',
            REAL_GEMINI_STATUS: 'FAIL',
            POSTGRES_INTEGRATION: 'TIMED_OUT',
            SECURITY_TESTS: 'TIMED_OUT',
            BACKEND_REGRESSION: 'TIMED_OUT',
        }, [], { realGemini: { valid: false, model: 'gemini-test', observedPricedProviderChargeUsdAcrossIncompleteAttempts: 0.011893752,
            textRequestAttemptsBothEngines: 49, visionRequestAttemptsBothEngines: 6,
            campaignLedger: { requestAttempts: 55, baselineAttempts: 51, candidateAttempts: 4,
                providerTextCalls: 48, providerVisionCalls: 6, unpricedOrPendingRequests: 1 } } }, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: { comparisonValid: false },
            sourceCandidate: null,
            realCandidate: { requestAttempts: 55, providerUsageRecords: 54, unpricedProviderCalls: 1 },
            realComparisonStatus: 'FAIL',
            photosTested: null,
            photoCategoryMatches: 0,
            photoColorMatches: 0,
            integration: null,
            integrationVerifierStep: { name: 'postgres-redis-worker-webhook-and-full-backend-regression', status: 'FAIL', timedOut: true },
            playwright: null,
            privacy: null,
            independent: null,
            campaign: { requestCount: 55, maxRequests: 256, visionRequestCount: 6, maxVisionRequests: 12,
                estimatedProviderChargeUsd: 0.011893752, unpricedRequestCount: 1, ceilingUsd: 2 },
            campaignSummary: { providerUsageRecords: 54, unpricedOrPendingRequests: 1 },
            backendRegressionTests: 'NOT_MEASURED',
            selectedIntegrationTests: 'NOT_MEASURED',
            webhookTests: 'NOT_MEASURED',
            totalIncorrectOrUnansweredSlots: null,
            automatedQaVerdict: 'FAIL',
            integrationReady: false,
        });

        expect(markdown).toContain('The matched Gemini comparison is incomplete; quality and matched-pair cost are NOT_MEASURED.');
        expect(markdown).toContain('No completed true-photo comparison is available.');
        expect(markdown).toContain('Observed campaign activity remains in the cumulative ledger');
        expect(markdown).toContain('55 attempts (51 baseline-stage, 4 candidate-stage)');
        expect(markdown).toContain('The estimated priced usage is $0.01189375 from the cumulative campaign ledger; this is not matched-pair cost.');
        expect(markdown).toContain('Outer integration verification timed out; no inner integration receipt was written, so individual integration assertions are NOT_MEASURED.');
        expect(markdown).toContain('Security tests: **TIMED_OUT**');
        expect(markdown).not.toContain('evaluated unknown unique licensed public photos');
        expect(markdown).not.toContain('Estimated matched-pair provider cost from priced usage: $0.00000000');
    });

    test('reports a Playwright process exit with no completed journey as incomplete', () => {
        const markdown = renderMarkdown(proof, {
            ...status,
            PLAYWRIGHT_E2E: 'INCOMPLETE',
        }, [], {}, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: null,
            integration: null,
            playwright: { playwrightExitCode: 4294967295, tests: {
                passed: 0, failed: 1, results: [{ status: 'failed', duration: '0ms' }],
            } },
            playwrightAssessment: 'INCOMPLETE',
        });

        expect(markdown).toContain('Playwright process exited with code 4294967295; its report contains no completed browser journey, so browser behavior and accessibility are NOT_MEASURED.');
        expect(markdown).toContain('| Browser QA | INCOMPLETE |');
    });

    test('documents the assistant-grounded context rule for false-refusal scoring', () => {
        const markdown = renderMarkdown(proof, status, [], {}, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: null,
        });

        expect(markdown).toContain('False-refusal scoring accepts a current turn with VERIFIED product evidence and a matching contract-valid READY presentation.');
        expect(markdown).toContain('Otherwise, a context-dependent turn is evaluated only when every earlier turn in that conversation executed and an earlier assistant turn had a SEND disposition for a non-refusal reply with a contract-valid READY presentation grounding the same product.');
        expect(markdown).toContain('This is approved replay output; actual Messenger delivery is not established.');
        expect(markdown).toContain('An intervening product `NOT_FOUND` clears prior assistant context; context-only turns without current evidence and a complete grounding chain remain not evaluable.');
    });

    test('calculates cost per verified answer turn separately from cost per verified fact slot', () => {
        expect(calculateCandidateCostMetrics(true, {
            estimatedProviderChargeUsd: 0.014899,
            verifiedCorrectTurns: 13,
            verifiedCorrectAnswers: 16,
            unpricedProviderCalls: 0,
        })).toEqual({
            estimatedCostPerCandidateVerifiedAnswerUsd: 0.014899 / 13,
            estimatedCostPerCandidateVerifiedFactSlotUsd: 0.014899 / 16,
        });
        expect(calculateCandidateCostMetrics(true, {
            estimatedProviderChargeUsd: 0.014899,
            verifiedCorrectTurns: 0,
            verifiedCorrectAnswers: 16,
            unpricedProviderCalls: 0,
        })).toEqual({
            estimatedCostPerCandidateVerifiedAnswerUsd: null,
            estimatedCostPerCandidateVerifiedFactSlotUsd: 0.014899 / 16,
        });
        expect(calculateCandidateCostMetrics(true, {
            estimatedProviderChargeUsd: 0.014899,
            verifiedCorrectTurns: 13,
            verifiedCorrectAnswers: 16,
            unpricedProviderCalls: 1,
        })).toEqual({
            estimatedCostPerCandidateVerifiedAnswerUsd: null,
            estimatedCostPerCandidateVerifiedFactSlotUsd: null,
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

    test('summarizes campaign attempts separately from provider-reported calls', () => {
        expect(summarizeCampaignLedger({ unpricedRequestCount: 1, calls: [
            { stage: 'baseline-v1-2-source-real-gemini-baseline-id', status: 'provider_reported', vision: false },
            { stage: 'baseline-v1-2-source-real-gemini-baseline-id', status: 'pending', vision: false },
            { stage: 'candidate-v1-3-source-real-gemini-candidate-id', status: 'provider_reported', vision: true },
        ] })).toEqual({
            requestAttempts: 3,
            providerUsageRecords: 2,
            providerTextCalls: 1,
            providerVisionCalls: 1,
            textRequestAttempts: 2,
            visionRequestAttempts: 1,
            unpricedOrPendingRequests: 1,
            baselineAttempts: 2,
            candidateAttempts: 1,
        });
        expect(summarizeCampaignLedger(null).requestAttempts).toBeNull();
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
                credentialStatus: 'AUTHENTICATED',
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
            realComparison: { comparisonValid: true, model: 'gemini-3.1-flash-lite' },
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
        expect(markdown).toContain('Credential status: AUTHENTICATED; the process-scoped value is not recorded.');
        expect(markdown).toContain('Provider-reported traffic across matched arms: 7 text and 3 vision calls.');
        expect(markdown).toContain('Request attempts across matched arms: 8 text and 3 vision.');
        expect(markdown).toContain('Candidate unpriced provider calls: 0.');
        expect(markdown).toContain('Rejected campaign ledger attempts: 1 (blocked before provider usage).');
        expect(markdown).toContain('Candidate run ledger: 74 request attempts, 73 provider usage records, 1 rejected reservation.');
        expect(markdown).toContain('Candidate cost per verified product-answer turn: $0.00114608; per verified fact slot: $0.00093119.');
    });

    test('labels deterministic and paid latency separately and reports paid outcomes and regressions', () => {
        const markdown = renderMarkdown({
            ...proof,
            measured: { estimatedCostPerCandidateVerifiedAnswerUsd: 0.01, estimatedCostPerCandidateVerifiedFactSlotUsd: 0.005 },
        }, { ...status, REAL_GEMINI_QUALITY_VERDICT: 'PASS' }, [], {
            realGemini: {
                model: 'gemini-3.1-flash-lite', estimatedProviderChargeUsdBothEngines: 0.032989,
                metricOutcomes: { verifiedCorrectAnswers: 'IMPROVED', estimatedProviderChargeUsd: 'REGRESSED', p95RouteMs: 'REGRESSED' },
                baseline: { verifiedCorrectAnswers: 7, eligibleFactSlots: 18, verifiedCorrectTurns: 5, evaluatedAnswerableProductTurns: 15, estimatedProviderChargeUsd: 0.0112425, p50ProviderMs: 1194, p95RouteMs: 5305.31, p95ProviderMs: 2786 },
                candidate: { verifiedCorrectAnswers: 18, eligibleFactSlots: 18, verifiedCorrectTurns: 15, evaluatedAnswerableProductTurns: 15, estimatedProviderChargeUsd: 0.0217465, p50RouteMs: 4349.419, p95RouteMs: 5399.128, p50ProviderMs: 1138, p95ProviderMs: 1809 },
            },
        }, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: { comparisonValid: true, model: 'gemini-3.1-flash-lite', metricOutcomes: { verifiedCorrectAnswers: 'IMPROVED', estimatedProviderChargeUsd: 'REGRESSED', p95RouteMs: 'REGRESSED' } },
            sourceCandidate: { p50RouteMs: 1.091, p95RouteMs: 2.923 },
            realBaseline: { verifiedCorrectAnswers: 7, eligibleFactSlots: 18, verifiedCorrectTurns: 5, evaluatedAnswerableProductTurns: 15, estimatedProviderChargeUsd: 0.0112425, p50ProviderMs: 1194, p95RouteMs: 5305.31, p95ProviderMs: 2786 },
            realCandidate: { verifiedCorrectAnswers: 18, eligibleFactSlots: 18, verifiedCorrectTurns: 15, evaluatedAnswerableProductTurns: 15, estimatedProviderChargeUsd: 0.0217465, p50RouteMs: 4349.419, p95RouteMs: 5399.128, p50ProviderMs: 1138, p95ProviderMs: 1809 },
            photosTested: 3, photoCategoryMatches: 0, photoColorMatches: 3, photoIdentityScored: false,
        });

        expect(markdown).toContain('Deterministic source replay router p50/p95: 1.091 ms / 2.923 ms');
        expect(markdown).toContain('Paid candidate route p50/p95: 4349.419 ms / 5399.128 ms');
        expect(markdown).toContain('Paid candidate provider p50/p95: 1138 ms / 1809 ms (baseline 1194 ms / 2786 ms).');
        expect(markdown).toContain('Paid Gemini source comparison: verified fact answers 7/18 baseline to 18/18 candidate');
        expect(markdown).toContain('Paid matched-pair estimated cost: $0.03298900; candidate $0.02174650 vs baseline $0.01124250 (REGRESSED)');
        expect(markdown).toContain('Paid route p95 outcome: REGRESSED');
        expect(markdown).toContain('Paid public-photo probe: category 0/3, visible color 3/3; catalog identity NOT SCORED');
    });

    test('uses the actual nested integration receipt for the backend integration section', () => {
        const markdown = renderMarkdown(proof, status, [], {}, {
            sourceOracle: null,
            sourceComparison: null,
            heldoutComparison: null,
            realComparison: null,
            integration: {
                status: 'PASS',
                jest: {
                    selectedIntegration: { exitCode: 0, structured: { passedTests: 12 } },
                    webhookPipelineE2E: { exitCode: 0, structured: { passedTests: 46 } },
                    backendRegression: { exitCode: 0, structured: { passedTests: 3959 } },
                },
            },
            selectedIntegrationTests: '12 passed',
            webhookTests: '46 passed',
            backendRegressionTests: '3,959 passed',
        });

        expect(markdown).toContain('Receipt status: **PASS**');
        expect(markdown).toContain('Selected integration: 12 passed');
        expect(markdown).toContain('webhook pipeline: 46 passed');
        expect(markdown).toContain('full backend regression: 3,959 passed');
    });

    test('uses dynamic paid quality and explicit photo verdict in Section D and the machine table', () => {
        const markdown = renderMarkdown(proof, {
            ...status,
            REAL_GEMINI_QUALITY_VERDICT: 'PASS',
            REAL_GEMINI_VISION_VERDICT: 'FAIL',
        }, [], { realGemini: { model: 'gemini-3.1-flash-lite', quality: { status: 'PASS' } } }, {
            sourceOracle: null, sourceComparison: null, heldoutComparison: null,
            realComparison: { comparisonValid: true },
            realGeminiQuality: { status: 'PASS' },
            genuinePhotoQuality: { status: 'FAIL' },
            photosTested: 3, photoCategoryMatches: 0, photoColorMatches: 3,
        });

        expect(markdown).toContain('The paid Gemini candidate quality gate is PASS.');
        expect(markdown).not.toContain('the paid Gemini candidate has a separate quality verdict in Section E and does not pass.');
        expect(markdown).toContain('| `REAL_GEMINI_VISION_VERDICT` | FAIL |');
        expect(markdown).toContain('Photo acceptance verdict: **FAIL**');
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
