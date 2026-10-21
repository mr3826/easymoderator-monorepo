'use strict';

const { renderMarkdown } = require('./generate-product-engine-v1-3-proof');

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

        expect(markdown).toContain('Estimated matched-pair provider cost: NOT_RUN.');
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
            photosTested: 3,
            photoCategoryMatches: 2,
            photoColorMatches: 1,
        });

        expect(markdown).toContain('Estimated matched-pair provider cost: $0.12345678.');
    });
});
