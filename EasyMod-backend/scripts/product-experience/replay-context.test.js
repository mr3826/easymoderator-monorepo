'use strict';

const grounding = require('../../src/modules/ai/grounding');
const { latestGroundedProductId, referencesForReplayTurn } = require('./replay-context');

describe('replay oracle context', () => {
    test('uses the newest fresh grounded product reference', () => {
        const now = Date.now();
        const history = [{
            role: 'assistant',
            sourceReferences: [{ kind: 'product', id: 'fixture-product-1' }],
            createdAt: new Date(now - 60_000).toISOString(),
        }];

        expect(latestGroundedProductId(history, now)).toBe('fixture-product-1');
    });

    test('clears product identity after a newer assistant turn without references', () => {
        const now = Date.now();
        const history = [
            {
                role: 'assistant',
                sourceReferences: [{ kind: 'product', id: 'fixture-product-1' }],
                createdAt: new Date(now - 120_000).toISOString(),
            },
            { role: 'user', content: 'A different question' },
            { role: 'assistant', sourceReferences: null, createdAt: new Date(now - 60_000).toISOString() },
        ];

        expect(latestGroundedProductId(history, now)).toBeNull();
    });

    test('does not carry a related alternative as the selected product', () => {
        const now = Date.now();
        const history = [{
            role: 'assistant',
            sourceReferences: [{ kind: 'product', id: 'related-product', contextEligible: false }],
            createdAt: new Date(now - 60_000).toISOString(),
        }];

        expect(latestGroundedProductId(history, now)).toBeNull();
    });

    test('retains a route-verified product pointer when an attachment has metadata but no pixels', () => {
        const refs = [{ kind: 'product', id: 'fixture-product-1', contextEligible: true }];
        expect(referencesForReplayTurn(refs)).toEqual(refs);
    });
});
