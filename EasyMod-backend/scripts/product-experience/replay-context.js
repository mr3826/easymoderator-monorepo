'use strict';

const grounding = require('../../src/modules/ai/grounding');

const latestGroundedProductId = (history, now = Date.now()) => (
    grounding.contextProductIds(history, { now })[0] || null
);

const referencesForReplayTurn = (sourceReferences, inputType) => (
    ['IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE'].includes(inputType) ? null : (sourceReferences || null)
);

module.exports = { latestGroundedProductId, referencesForReplayTurn };
