'use strict';

const { isUnnecessaryProductRefusal } = require('./lab-scorer');

const EXECUTED = 'EXECUTED';

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
    const evaluatedFalseRefusalTurns = falseRefusalExpectedTurns.filter(item => item.evaluationStatus === EXECUTED
        && Number.isFinite(item.factScores?.eligibleSlots)
        && Number.isFinite(item.factScores?.correctAnsweredSlots)
        && typeof item.disposition === 'string'
        && typeof item.finalReplyRedacted === 'string');
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
