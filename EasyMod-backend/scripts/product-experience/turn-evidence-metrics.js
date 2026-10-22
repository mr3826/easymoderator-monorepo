'use strict';

const { isUnnecessaryProductRefusal } = require('./lab-scorer');

const EXECUTED = 'EXECUTED';

const assistantApprovedProductOutput = (item, productId) => item.evaluationStatus === EXECUTED
    && item.disposition === 'SEND'
    && typeof item.finalReplyRedacted === 'string'
    && item.finalReplyRedacted.trim().length > 0
    && !isUnnecessaryProductRefusal({
        response: item.finalReplyRedacted,
        disposition: item.disposition,
        answerableSlots: 1,
        correctAnsweredSlots: 0,
    })
    && item.presentation?.status === 'READY'
    && item.presentation?.contractValid === true
    && Array.isArray(item.presentation?.products)
    && item.presentation.products.some(product => String(product.id) === String(productId));

const currentGroundedProductPresentation = (item, productId) => item.evaluationStatus === EXECUTED
    && item.productEvidence?.status === 'VERIFIED'
    && (item.productEvidence?.productIds || []).map(String).includes(String(productId))
    && item.presentation?.status === 'READY'
    && item.presentation?.contractValid === true
    && Array.isArray(item.presentation?.products)
    && item.presentation.products.some(product => String(product.id) === String(productId));

const hasActiveAssistantGroundedContext = (item, personaTurns) => {
    const contextProductId = item.oracle?.sourceContextProductId;
    const requestedProductId = item.oracle?.productId;
    if (requestedProductId && currentGroundedProductPresentation(item, requestedProductId)) return true;
    if (!contextProductId || !requestedProductId || String(contextProductId) !== String(requestedProductId)) return true;

    const turnNumber = Number(item.turn);
    if (!Number.isFinite(turnNumber) || personaTurns.some(prior => !Number.isFinite(Number(prior.turn)))) return false;
    const priorTurns = personaTurns.filter(prior => Number(prior.turn) < turnNumber)
        .sort((left, right) => Number(left.turn) - Number(right.turn));
    if (priorTurns.some(prior => prior.evaluationStatus !== EXECUTED)) return false;

    let activeProductId = null;
    for (const prior of priorTurns) {
        const priorContextProductId = prior.oracle?.sourceContextProductId
            ? String(prior.oracle.sourceContextProductId) : null;
        const priorRequestedProductId = prior.oracle?.productId
            ? String(prior.oracle.productId) : null;

        if (!priorContextProductId || (priorRequestedProductId && priorRequestedProductId !== priorContextProductId)) {
            activeProductId = null;
        } else if (activeProductId && activeProductId !== priorContextProductId) {
            activeProductId = null;
        }

        const groundedProductIds = (prior.productEvidence?.productIds || []).map(String);
        if (priorRequestedProductId && groundedProductIds.includes(priorRequestedProductId)
            && assistantApprovedProductOutput(prior, priorRequestedProductId)) {
            activeProductId = priorRequestedProductId;
        } else if (priorContextProductId && priorRequestedProductId === priorContextProductId
            && prior.productEvidence?.status === 'NOT_FOUND') {
            activeProductId = null;
        }
    }

    return activeProductId === String(contextProductId);
};

const summarizeTurnEvidence = (turnResults) => {
    const turnsByPersona = new Map();
    for (const item of turnResults) {
        const personaTurns = turnsByPersona.get(item.personaId) || [];
        personaTurns.push(item);
        turnsByPersona.set(item.personaId, personaTurns);
    }

    const contextDependentAnswerableTurns = turnResults.filter(item => item.oracle?.sourceContextProductId
        && item.oracle?.eligibility === 'ANSWERABLE');
    const evaluatedContextDependentAnswerableTurns = contextDependentAnswerableTurns.filter(item => {
        if (item.evaluationStatus !== EXECUTED) return false;
        return (turnsByPersona.get(item.personaId) || []).every(prior =>
            Number(prior.turn) >= Number(item.turn) || prior.evaluationStatus === EXECUTED);
    });
    const contextResolutionFailures = evaluatedContextDependentAnswerableTurns.filter(item =>
        !(item.productEvidence?.productIds || []).map(String).includes(String(item.oracle.productId))).length;
    const contextResolutionVerifiedTurns = evaluatedContextDependentAnswerableTurns.length - contextResolutionFailures;

    const crossDomainHandoffTurns = turnResults.filter(item => (item.oracle?.crossDomainHandoffs || []).length > 0);
    const evaluatedCrossDomainHandoffTurns = crossDomainHandoffTurns.filter(item => item.evaluationStatus === EXECUTED);
    const safeCrossDomainHandoffs = evaluatedCrossDomainHandoffTurns.filter(item => item.oracle.safeCrossDomainHandoff === true).length;

    const falseRefusalExpectedTurns = turnResults.filter(item => item.oracle?.textOnlyMetricEligible === true
        && item.oracle?.eligibility === 'ANSWERABLE'
        && (item.oracle?.eligibleSlots || []).length > 0);
    const evaluatedFalseRefusalTurns = falseRefusalExpectedTurns.filter(item => {
        const personaTurns = turnsByPersona.get(item.personaId) || [];
        return item.evaluationStatus === EXECUTED
            && hasActiveAssistantGroundedContext(item, personaTurns)
            && Number.isFinite(item.factScores?.eligibleSlots)
            && Number.isFinite(item.factScores?.correctAnsweredSlots)
            && typeof item.disposition === 'string'
            && typeof item.finalReplyRedacted === 'string';
    });
    const falseRefusalSlots = evaluatedFalseRefusalTurns.reduce((sum, item) => sum + (
        isUnnecessaryProductRefusal({
            response: item.finalReplyRedacted,
            disposition: item.disposition,
            answerableSlots: item.factScores.eligibleSlots,
            correctAnsweredSlots: item.factScores.correctAnsweredSlots,
        }) ? item.factScores.eligibleSlots : 0
    ), 0);

    return {
        contextDependentAnswerableTurns: contextDependentAnswerableTurns.length,
        evaluatedContextDependentAnswerableTurns: evaluatedContextDependentAnswerableTurns.length,
        contextResolutionNotEvaluableTurns: contextDependentAnswerableTurns.length - evaluatedContextDependentAnswerableTurns.length,
        contextResolutionFailures,
        contextResolutionVerifiedTurns,
        crossDomainHandoffTurns: crossDomainHandoffTurns.length,
        evaluatedCrossDomainHandoffTurns: evaluatedCrossDomainHandoffTurns.length,
        crossDomainHandoffNotRunTurns: crossDomainHandoffTurns.length - evaluatedCrossDomainHandoffTurns.length,
        safeCrossDomainHandoffs,
        unsafeCrossDomainHandoffs: evaluatedCrossDomainHandoffTurns.length - safeCrossDomainHandoffs,
        falseRefusalSlots,
        falseRefusalExpectedTurns: falseRefusalExpectedTurns.length,
        falseRefusalEvaluatedTurns: evaluatedFalseRefusalTurns.length,
        falseRefusalNotEvaluableTurns: falseRefusalExpectedTurns.length - evaluatedFalseRefusalTurns.length,
    };
};

module.exports = { summarizeTurnEvidence };
