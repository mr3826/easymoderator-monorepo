'use strict';

const { summarizeTurnEvidence } = require('./turn-evidence-metrics');

describe('turn evidence metrics', () => {
    test('does not score context turns after an unexecuted conversation turn', () => {
        const summary = summarizeTurnEvidence([
            {
                personaId: 'P01', turn: 1, evaluationStatus: 'NOT_RUN_PROVIDER_FAILURE',
                oracle: { eligibility: 'ANSWERABLE', sourceContextProductId: null, crossDomainHandoffs: [] },
                productEvidence: { productIds: [] },
            },
            {
                personaId: 'P01', turn: 2, evaluationStatus: 'EXECUTED',
                oracle: { eligibility: 'ANSWERABLE', sourceContextProductId: 'product-1', crossDomainHandoffs: [] },
                productEvidence: { productIds: [] },
            },
            {
                personaId: 'P02', turn: 1, evaluationStatus: 'EXECUTED',
                oracle: { eligibility: 'ANSWERABLE', sourceContextProductId: null, crossDomainHandoffs: [] },
                productEvidence: { productIds: ['product-1'] },
            },
            {
                personaId: 'P02', turn: 2, evaluationStatus: 'EXECUTED',
                oracle: { eligibility: 'ANSWERABLE', sourceContextProductId: 'product-1', crossDomainHandoffs: [] },
                productEvidence: { productIds: [] },
            },
        ]);

        expect(summary).toMatchObject({
            contextDependentAnswerableTurns: 2,
            evaluatedContextDependentAnswerableTurns: 1,
            contextResolutionNotEvaluableTurns: 1,
            contextResolutionFailures: 1,
            contextResolutionVerifiedTurns: 0,
        });
    });

    test('separates unrun handoffs from executed unsafe handoffs', () => {
        const summary = summarizeTurnEvidence([
            {
                personaId: 'P01', turn: 1, evaluationStatus: 'NOT_RUN_PROVIDER_FAILURE',
                oracle: { eligibility: 'INELIGIBLE', sourceContextProductId: null, crossDomainHandoffs: ['refund'] },
                productEvidence: { productIds: [] },
            },
            {
                personaId: 'P02', turn: 1, evaluationStatus: 'EXECUTED',
                oracle: { eligibility: 'INELIGIBLE', sourceContextProductId: null, crossDomainHandoffs: ['order'], safeCrossDomainHandoff: true },
                productEvidence: { productIds: [] },
            },
            {
                personaId: 'P03', turn: 1, evaluationStatus: 'EXECUTED',
                oracle: { eligibility: 'INELIGIBLE', sourceContextProductId: null, crossDomainHandoffs: ['exchange'] },
                productEvidence: { productIds: [] },
            },
        ]);

        expect(summary).toMatchObject({
            crossDomainHandoffTurns: 3,
            evaluatedCrossDomainHandoffTurns: 2,
            crossDomainHandoffNotRunTurns: 1,
            safeCrossDomainHandoffs: 1,
            unsafeCrossDomainHandoffs: 1,
        });
    });

    test('counts an executed answerable product-not-found reply but leaves provider failures unscored', () => {
        const summary = summarizeTurnEvidence([
            {
                personaId: 'P01', turn: 1, evaluationStatus: 'EXECUTED', disposition: 'SEND',
                finalReplyRedacted: "Sorry — I couldn't find that product in our current catalog.",
                oracle: { textOnlyMetricEligible: true, eligibility: 'ANSWERABLE', eligibleSlots: [{}], crossDomainHandoffs: [] },
                factScores: { eligibleSlots: 1, correctAnsweredSlots: 0 },
            },
            {
                personaId: 'P02', turn: 1, evaluationStatus: 'NOT_RUN_PROVIDER_FAILURE', disposition: 'SAFE_FALLBACK',
                finalReplyRedacted: 'I could not verify that right now.',
                oracle: { textOnlyMetricEligible: true, eligibility: 'ANSWERABLE', eligibleSlots: [{}], crossDomainHandoffs: [] },
                factScores: { eligibleSlots: 1, correctAnsweredSlots: null },
            },
        ]);

        expect(summary).toMatchObject({
            falseRefusalSlots: 1,
            falseRefusalExpectedTurns: 2,
            falseRefusalEvaluatedTurns: 1,
            falseRefusalNotEvaluableTurns: 1,
        });
    });
});
