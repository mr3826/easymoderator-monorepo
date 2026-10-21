'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseCsv, DEFAULT_INPUT } = require('./replay');
const { buildDatasetIndex, classifyMessageIntent, classifyOracleTurn, createOracleContextTracker } = require('./lab-contracts');
const { createV12Catalog } = require('./catalog-fixtures-v1-2');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ARTIFACT_ROOT = path.resolve(process.env.LAB_ARTIFACT_ROOT
    || path.resolve(__dirname, '../../../docs/ai/product-experience-v1-3/artifacts'));
const OUTPUT_ROOT = path.join(ARTIFACT_ROOT, 'benchmarks');
const DEFAULT_OUTPUT = path.join(OUTPUT_ROOT, 'customer-truth-oracle.json');

const aggregate = (rows, valueFor) => rows.reduce((result, row) => {
    const value = valueFor(row);
    result[value] = (result[value] || 0) + 1;
    return result;
}, {});

const buildOracle = (sourceBytes, catalog) => {
    buildDatasetIndex(sourceBytes);
    const { records } = parseCsv(sourceBytes.toString('utf8'));
    const personas = new Map();
    for (const record of records) {
        const sourcePersona = String(record.personaId || '').trim();
        if (!personas.has(sourcePersona)) personas.set(sourcePersona, []);
        personas.get(sourcePersona).push(record);
    }
    const rows = [];
    let personaOrdinal = 0;
    for (const [, turns] of personas) {
        personaOrdinal += 1;
        const personaId = `P${String(personaOrdinal).padStart(2, '0')}`;
        const tenantId = personaOrdinal % 2 ? 'fixture-shop-a' : 'fixture-shop-b';
        const context = createOracleContextTracker(tenantId, catalog);
        for (const record of turns) {
            const turn = Number.parseInt(record.turn, 10);
            const scenarioId = `scenario-${String(personaOrdinal).padStart(2, '0')}-${String(turn).padStart(2, '0')}`;
            const sourceContextProductId = context.currentProductId();
            const classification = classifyMessageIntent(record);
            const result = classifyOracleTurn(record, tenantId, catalog, sourceContextProductId);
            rows.push({
                scenarioId,
                personaId,
                turn,
                inputType: String(record.inputType || 'Text').trim(),
                language: String(record.language || 'Other').trim(),
                domains: result.domains || classification.domains || [],
                classificationTags: result.classificationTags || classification.tags,
                requiredAuthority: result.requiredAuthority || classification.authority,
                eligibility: result.eligibility,
                productId: result.productId || null,
                selectedVariantId: result.selectedVariantId || null,
                variantResolution: result.variantResolution || null,
                eligibleSlots: result.eligibleSlots || [],
                unknownRequestedFields: result.unknownRequestedFields || [],
                crossDomainHandoffs: result.crossDomainHandoffs || [],
                imageAuthority: result.imageAuthority || null,
                textOnlyMetricEligible: result.textOnlyMetricEligible === true,
                sourceContextProductId,
                contextSource: 'SOURCE_CUSTOMER_TURNS_ONLY',
            });
            context.observeSourceTurn(record);
        }
    }
    return rows;
};

const main = () => {
    const sourcePath = path.resolve(process.env.LAB_DATASET_PATH || DEFAULT_INPUT);
    const outputPath = path.resolve(process.env.LAB_ORACLE_PATH || DEFAULT_OUTPUT);
    if (!outputPath.startsWith(`${OUTPUT_ROOT}${path.sep}`)) throw new Error('Oracle artifact path is outside the V1.3 benchmark directory.');
    const sourceBytes = fs.readFileSync(sourcePath);
    const catalog = createV12Catalog();
    const rows = buildOracle(sourceBytes, catalog);
    const oracleText = JSON.stringify(rows);
    const sourceSha256 = hash(sourceBytes);
    const oracleSha256 = hash(oracleText);
    const catalogPath = path.join(__dirname, 'catalog-fixtures-v1-2.js');
    const catalogFixtureSha256 = hash(fs.readFileSync(catalogPath));
    const artifact = {
        schemaVersion: 1,
        oracleVersion: 'product-engine-v1.3-customer-truth-1',
        createdAt: new Date().toISOString(),
        source: {
            sha256: sourceSha256,
            personas: new Set(rows.map(row => row.personaId)).size,
            turns: rows.length,
            expectedAiTruthUsed: false,
            rawMessagesPersisted: false,
        },
        catalog: {
            authority: 'versioned two-tenant synthetic catalog fixture',
            sha256: catalogFixtureSha256,
            rawCatalogCopied: false,
        },
        oracleSha256,
        summary: {
            answerableProductTurns: rows.filter(row => row.textOnlyMetricEligible && row.eligibility === 'ANSWERABLE').length,
            eligibleFactSlots: rows.filter(row => row.textOnlyMetricEligible).reduce((sum, row) => sum + row.eligibleSlots.length, 0),
            imageBearingTurnsNotEvaluated: rows.filter(row => !row.textOnlyMetricEligible).length,
            imageBearingTextResolvableTurnsExcluded: rows.filter(row => !row.textOnlyMetricEligible && row.eligibility === 'ANSWERABLE').length,
            imageBearingFactSlotsExcluded: rows.filter(row => !row.textOnlyMetricEligible).reduce((sum, row) => sum + row.eligibleSlots.length, 0),
            domains: aggregate(rows, row => row.domains.join('+') || 'UNCLASSIFIED'),
            eligibility: aggregate(rows, row => row.eligibility),
            crossDomainHandoffRequests: rows.reduce((sum, row) => sum + row.crossDomainHandoffs.length, 0),
        },
        turns: rows,
    };
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    if (/customerMessage|customerProfile|expectedTruth|simulatedAttachment|Expected AI Truth/i.test(serialized)) {
        throw new Error('Oracle artifact includes source message, profile, attachment, or advisory-answer fields.');
    }
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    fs.writeFileSync(outputPath, serialized, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({
        status: 'PASS', outputPath, sourceSha256, oracleSha256, catalogFixtureSha256,
        personas: artifact.source.personas,
        turns: artifact.source.turns,
        answerableProductTurns: artifact.summary.answerableProductTurns,
        eligibleFactSlots: artifact.summary.eligibleFactSlots,
        crossDomainHandoffRequests: artifact.summary.crossDomainHandoffRequests,
    }) + '\n');
};

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`Oracle generation failed: ${String(error?.message || 'UNKNOWN_ERROR')}\n`);
        process.exitCode = 1;
    }
}

module.exports = { buildOracle };
