'use strict';

const fs = require('node:fs');
const { DEFAULT_INPUT, normalizeInputType } = require('./replay');
const { buildOracle } = require('./benchmark-oracle');
const { createV12Catalog } = require('./catalog-fixtures-v1-2');

describe.skipIf(!fs.existsSync(DEFAULT_INPUT))('frozen independent customer-truth oracle', () => {
    test('classifies the unchanged 200-turn source without persisting message or advisory-answer cells', () => {
        const source = fs.readFileSync(DEFAULT_INPUT);
        const rows = buildOracle(source, createV12Catalog());
        expect(rows).toHaveLength(200);
        expect(new Set(rows.map(row => row.personaId)).size).toBe(20);
        expect(rows.every(row => row.contextSource === 'SOURCE_CUSTOMER_TURNS_ONLY')).toBe(true);
        expect(rows.some(row => row.eligibility === 'ANSWERABLE')).toBe(true);
        expect(JSON.stringify(rows)).not.toMatch(/customerMessage|customerProfile|expectedTruth|simulatedAttachment/i);
        expect(rows.some(row => row.domains.includes('merchant_policy') && row.domains.some(domain => domain.startsWith('product_')))).toBe(true);
    });

    test('keeps image-bearing source turns out of the text-only answerability count', () => {
        const rows = buildOracle(fs.readFileSync(DEFAULT_INPUT), createV12Catalog());
        const imageRows = rows.filter(row => !row.textOnlyMetricEligible);
        expect(imageRows.length).toBeGreaterThan(0);
        expect(imageRows.every(row => row.imageAuthority === 'NO_REAL_IMAGE_EVALUATED')).toBe(true);
        expect(imageRows.filter(row => ['IMAGE', 'IMAGE_IMAGE'].includes(normalizeInputType(row.inputType)))
            .every(row => row.eligibility === 'NOT_ANSWERABLE')).toBe(true);
        expect(imageRows.some(row => normalizeInputType(row.inputType) === 'IMAGE_TEXT' && row.eligibility === 'ANSWERABLE')).toBe(true);
        expect(rows.filter(row => row.textOnlyMetricEligible && row.eligibility === 'ANSWERABLE').length)
            .toBeGreaterThan(0);
    });
});
