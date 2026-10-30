'use strict';

const { resolveComparisonOptions } = require('./comparison-options');

describe('Product Engine comparison options', () => {
    test('allows a paid held-out comparison with a caller-selected campaign ceiling', () => {
        expect(resolveComparisonOptions({
            LAB_COMPARISON_MODE: 'real-gemini',
            LAB_COMPARISON_DATASET: 'heldout',
            LAB_RUN_SCOPE: 'full',
            LAB_CAMPAIGN_CEILING_USD: '0.8',
        })).toEqual({
            mode: 'real-gemini',
            datasetName: 'heldout',
            scope: 'full',
            personaId: '',
            campaignCeilingUsd: 0.8,
        });
    });

    test('rejects a paid campaign ceiling above the enforced per-campaign maximum', () => {
        expect(() => resolveComparisonOptions({
            LAB_COMPARISON_MODE: 'real-gemini',
            LAB_CAMPAIGN_CEILING_USD: '2.01',
        })).toThrow('V1.3 campaign ceiling is invalid.');
    });
});
