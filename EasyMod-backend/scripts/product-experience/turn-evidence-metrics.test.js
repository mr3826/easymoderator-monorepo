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
                oracle: { textOnlyMetricEligible: true, eligibility: 'ANSWERABLE', productId: 'product-1', sourceContextProductId: null, eligibleSlots: [{}], crossDomainHandoffs: [] },
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

    test('does not score a context-only refusal without active assistant-grounded product context', () => {
        const summary = summarizeTurnEvidence([
            {
                personaId: 'P01', turn: 1, evaluationStatus: 'EXECUTED', disposition: 'SEND',
                finalReplyRedacted: "Sorry — I couldn't find that product in our current catalog.",
                oracle: {
                    textOnlyMetricEligible: true, eligibility: 'ANSWERABLE', productId: 'product-1',
                    sourceContextProductId: 'product-1', eligibleSlots: [{}], crossDomainHandoffs: [],
                },
                productEvidence: { status: 'NOT_FOUND', productIds: [] },
                factScores: { eligibleSlots: 1, correctAnsweredSlots: 0 },
            },
        ]);

        expect(summary).toMatchObject({
            falseRefusalSlots: 0,
            falseRefusalExpectedTurns: 1,
            falseRefusalEvaluatedTurns: 0,
            falseRefusalNotEvaluableTurns: 1,
        });
    });

    test('scores context-only refusals only while earlier assistant-grounded product context remains active', () => {
        const summary = summarizeTurnEvidence([
            {
                personaId: 'P01', turn: 1, evaluationStatus: 'EXECUTED', disposition: 'SEND',
                finalReplyRedacted: 'Product One — available options and price are shown below.',
                oracle: { eligibility: 'ANSWERABLE', productId: 'product-1', sourceContextProductId: null, crossDomainHandoffs: [] },
                productEvidence: { status: 'VERIFIED', productIds: ['product-1'] },
                presentation: { status: 'READY', contractValid: true, products: [{ id: 'product-1' }] },
            },
            {
                personaId: 'P01', turn: 2, evaluationStatus: 'EXECUTED', disposition: 'SEND',
                finalReplyRedacted: "Sorry — I couldn't find that product in our current catalog.",
                oracle: {
                    textOnlyMetricEligible: true, eligibility: 'ANSWERABLE', productId: 'product-1',
                    sourceContextProductId: 'product-1', eligibleSlots: [{}], crossDomainHandoffs: [],
                },
                productEvidence: { status: 'NOT_FOUND', productIds: [] },
                factScores: { eligibleSlots: 1, correctAnsweredSlots: 0 },
            },
            {
                personaId: 'P01', turn: 3, evaluationStatus: 'EXECUTED', disposition: 'SEND',
                finalReplyRedacted: "Sorry — I couldn't find that product in our current catalog.",
                oracle: {
                    textOnlyMetricEligible: true, eligibility: 'ANSWERABLE', productId: 'product-1',
                    sourceContextProductId: 'product-1', eligibleSlots: [{}], crossDomainHandoffs: [],
                },
                productEvidence: { status: 'NOT_FOUND', productIds: [] },
                factScores: { eligibleSlots: 1, correctAnsweredSlots: 0 },
            },
        ]);

        expect(summary).toMatchObject({
            falseRefusalSlots: 1,
            falseRefusalExpectedTurns: 2,
            falseRefusalEvaluatedTurns: 1,
            falseRefusalNotEvaluableTurns: 1,
        });
    });

    test.each(['SAFE_FALLBACK', 'SUPPRESS', 'SEND_WITH_BLOCKED_PRESENTATION', 'SEND_WITH_REFUSAL'])(
        'does not treat verified evidence with %s as context delivered to the customer', disposition => {
            const priorDisposition = ['SEND_WITH_BLOCKED_PRESENTATION', 'SEND_WITH_REFUSAL'].includes(disposition) ? 'SEND' : disposition;
            const priorPresentationStatus = disposition === 'SEND_WITH_BLOCKED_PRESENTATION' ? 'BLOCKED' : 'READY';
            const summary = summarizeTurnEvidence([
                {
                    personaId: 'P01', turn: 1, evaluationStatus: 'EXECUTED', disposition: priorDisposition,
                    finalReplyRedacted: disposition === 'SEND_WITH_REFUSAL'
                        ? "Sorry — I couldn't find that product in our current catalog."
                        : 'I could not verify that right now.',
                    oracle: { eligibility: 'ANSWERABLE', productId: 'product-1', sourceContextProductId: null, crossDomainHandoffs: [] },
                    productEvidence: { status: 'VERIFIED', productIds: ['product-1'] },
                    presentation: { status: priorPresentationStatus, contractValid: true, products: [{ id: 'product-1' }] },
                },
                {
                    personaId: 'P01', turn: 2, evaluationStatus: 'EXECUTED', disposition: 'SEND',
                    finalReplyRedacted: "Sorry — I couldn't find that product in our current catalog.",
                    oracle: {
                        textOnlyMetricEligible: true, eligibility: 'ANSWERABLE', productId: 'product-1',
                        sourceContextProductId: 'product-1', eligibleSlots: [{}], crossDomainHandoffs: [],
                    },
                    productEvidence: { status: 'NOT_FOUND', productIds: [] },
                    factScores: { eligibleSlots: 1, correctAnsweredSlots: 0 },
                },
            ]);

            expect(summary).toMatchObject({
                falseRefusalSlots: 0,
                falseRefusalExpectedTurns: 1,
                falseRefusalEvaluatedTurns: 0,
                falseRefusalNotEvaluableTurns: 1,
            });
        },
    );

    test('does not score context-only refusals after an unexecuted turn breaks the conversation chain', () => {
        const summary = summarizeTurnEvidence([
            {
                personaId: 'P01', turn: 1, evaluationStatus: 'EXECUTED', disposition: 'SEND',
                oracle: { eligibility: 'ANSWERABLE', productId: 'product-1', sourceContextProductId: null, crossDomainHandoffs: [] },
                productEvidence: { status: 'VERIFIED', productIds: ['product-1'] },
            },
            {
                personaId: 'P01', turn: 2, evaluationStatus: 'NOT_RUN_PROVIDER_FAILURE', disposition: 'SAFE_FALLBACK',
                oracle: { eligibility: 'NOT_ANSWERABLE', productId: 'product-1', sourceContextProductId: 'product-1', crossDomainHandoffs: [] },
                productEvidence: { status: 'NONE', productIds: [] },
            },
            {
                personaId: 'P01', turn: 3, evaluationStatus: 'EXECUTED', disposition: 'SEND',
                finalReplyRedacted: "Sorry — I couldn't find that product in our current catalog.",
                oracle: {
                    textOnlyMetricEligible: true, eligibility: 'ANSWERABLE', productId: 'product-1',
                    sourceContextProductId: 'product-1', eligibleSlots: [{}], crossDomainHandoffs: [],
                },
                productEvidence: { status: 'NOT_FOUND', productIds: [] },
                factScores: { eligibleSlots: 1, correctAnsweredSlots: 0 },
            },
        ]);

        expect(summary).toMatchObject({
            falseRefusalSlots: 0,
            falseRefusalExpectedTurns: 1,
            falseRefusalEvaluatedTurns: 0,
            falseRefusalNotEvaluableTurns: 1,
        });
    });
});
