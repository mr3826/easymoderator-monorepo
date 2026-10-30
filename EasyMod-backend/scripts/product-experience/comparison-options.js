'use strict';

const MAX_CAMPAIGN_CEILING_USD = 2;

const resolveComparisonOptions = (env = process.env) => {
    const mode = env.LAB_COMPARISON_MODE || 'deterministic';
    const datasetName = env.LAB_COMPARISON_DATASET || 'source';
    const scope = env.LAB_RUN_SCOPE || 'full';
    const personaId = env.LAB_PERSONA_ID || '';
    const campaignCeilingUsd = env.LAB_CAMPAIGN_CEILING_USD === undefined
        ? MAX_CAMPAIGN_CEILING_USD : Number(env.LAB_CAMPAIGN_CEILING_USD);

    if (!['deterministic', 'real-gemini'].includes(mode) || !['source', 'heldout'].includes(datasetName)) {
        throw new Error('Choose comparison mode deterministic/real-gemini and dataset source/heldout.');
    }
    if (!['full', 'persona'].includes(scope) || (scope === 'persona' && !/^P(?:0[1-9]|1\d|20)$/.test(personaId))) {
        throw new Error('Comparison replay scope is invalid.');
    }
    if (!Number.isFinite(campaignCeilingUsd) || campaignCeilingUsd <= 0
        || campaignCeilingUsd > MAX_CAMPAIGN_CEILING_USD) {
        throw new Error('V1.3 campaign ceiling is invalid.');
    }

    return { mode, datasetName, scope, personaId, campaignCeilingUsd };
};

module.exports = { MAX_CAMPAIGN_CEILING_USD, resolveComparisonOptions };
