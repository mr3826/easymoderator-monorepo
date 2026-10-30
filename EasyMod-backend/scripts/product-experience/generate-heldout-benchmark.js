'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateDataset, parseCsv } = require('./replay');
const { createHeldoutRecords } = require('./heldout-fixtures-v1-3');

const ARTIFACT_ROOT = path.resolve(process.env.LAB_ARTIFACT_ROOT
    || path.resolve(__dirname, '../../../docs/ai/product-experience-v1-3/artifacts'));
const OUTPUT_ROOT = path.join(ARTIFACT_ROOT, 'benchmarks');
const DEFAULT_OUTPUT = path.join(OUTPUT_ROOT, 'heldout-customer-questions.csv');
const HEADERS = [
    'Persona ID', 'Customer Profile', 'Turn', 'Input Type', 'Language', 'Customer Message',
    'Simulated Attachment', 'Hallucination Risk and Test Intent', 'Expected AI Truth',
];
const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

const buildHeldoutCsv = () => {
    const rows = createHeldoutRecords();
    const content = [HEADERS, ...rows.map(row => [
        row.personaId, row.customerProfile, row.turn, row.inputType, row.language,
        row.customerMessage, row.simulatedAttachment, row.hallucinationRisk, row.expectedTruth,
    ])].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    validateDataset(parseCsv(content).records);
    return Buffer.from(content, 'utf8');
};

const main = () => {
    const outputPath = path.resolve(process.env.LAB_HELDOUT_PATH || DEFAULT_OUTPUT);
    if (!outputPath.startsWith(`${OUTPUT_ROOT}${path.sep}`)) throw new Error('Held-out benchmark path is outside the V1.3 benchmark directory.');
    const bytes = buildHeldoutCsv();
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    fs.writeFileSync(outputPath, bytes, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({
        status: 'PASS', outputPath,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        syntheticTurns: parseCsv(bytes.toString('utf8')).records.length,
        syntheticPersonas: 20,
        questionCases: 60,
        advisoryExpectedTruthCells: 0,
        sourceCustomerDataIncluded: false,
    }) + '\n');
};

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`Held-out benchmark generation failed: ${String(error?.message || 'UNKNOWN_ERROR')}\n`);
        process.exitCode = 1;
    }
}

module.exports = { buildHeldoutCsv };
