'use strict';

const grounding = require('../../src/modules/ai/grounding');

const latestGroundedProductId = (history, now = Date.now()) => (
    grounding.contextProductIds(history, { now })[0] || null
);

// The route's references are already backed by live tenant-scoped catalog
// evidence. Keeping the product ID is safe even when the simulator supplies
// only attachment metadata: no pixels become evidence, and every follow-up
// re-fetches the product under the current shop before using any fact.
const referencesForReplayTurn = sourceReferences => (
    Array.isArray(sourceReferences) && sourceReferences.length ? sourceReferences : null
);

module.exports = { latestGroundedProductId, referencesForReplayTurn };
