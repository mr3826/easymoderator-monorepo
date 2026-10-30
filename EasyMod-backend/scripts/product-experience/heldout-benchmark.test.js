'use strict';

const { buildHeldoutCsv } = require('./generate-heldout-benchmark');
const { parseCsv, validateDataset } = require('./replay');
const { buildOracle } = require('./benchmark-oracle');
const { createV12Catalog } = require('./catalog-fixtures-v1-2');

describe('independent V1.3 held-out benchmark', () => {
    test('contains 60 authored product cases without truth labels and is independently answerable by fixture oracle', () => {
        const bytes = buildHeldoutCsv();
        const parsed = parseCsv(bytes.toString('utf8'));
        expect(validateDataset(parsed.records)).toMatchObject({ personaCount: 20, scenarioCount: 200, orderedTurnsPerPersona: 10 });
        expect(parsed.records.filter(row => row.customerMessage.includes('Synthetic held-out')).length).toBe(0);
        expect(parsed.records.every(row => !row.expectedTruth)).toBe(true);

        const oracle = buildOracle(bytes, createV12Catalog());
        expect(oracle).toHaveLength(200);
        expect(oracle.filter(row => row.personaId <= 'P06' && row.textOnlyMetricEligible && row.eligibility === 'ANSWERABLE').length).toBeGreaterThan(6);
        expect(oracle.some(row => row.domains.includes('merchant_policy') && row.domains.some(domain => domain.startsWith('product_')))).toBe(true);
        expect(JSON.stringify(oracle)).not.toMatch(/customerMessage|customerProfile|expectedTruth|simulatedAttachment/i);
    });
});
