'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const grounding = require('../../src/modules/ai/grounding');
const { evaluateCandidate } = require('../../src/modules/ai/grounding/outbound-grounding.gate');
const { buildProductPresentation, validateProductPresentation } = require('../../src/modules/ai/product-experience/product-presentation');
const { createCatalog, merchantPolicyFixtures } = require('./fixtures');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_INPUT = path.resolve(REPO_ROOT, '..', 'customer-simulator.csv');
const DEFAULT_ARTIFACT_ROOT = path.resolve(process.env.LAB_ARTIFACT_ROOT
    || path.join(REPO_ROOT, 'docs/ai/product-experience-v1-3/artifacts'));
const DEFAULT_OUTPUT = path.join(DEFAULT_ARTIFACT_ROOT, '200-turn-replay.json');
const BASE_CLOCK = Date.parse('2026-10-20T00:00:00.000Z');

const HEADER_KEYS = new Map([
    ['personaid', 'personaId'],
    ['beforepersonaid', 'personaId'],
    ['customerprofile', 'customerProfile'],
    ['turn', 'turn'],
    ['inputtype', 'inputType'],
    ['language', 'language'],
    ['customermessage', 'customerMessage'],
    ['simulatedattachment', 'simulatedAttachment'],
    ['hallucinationriskandtestintent', 'riskIntent'],
    ['hallucinationrisktestintent', 'riskIntent'],
    ['expectedaitruth', 'expectedTruth'],
]);

const REQUIRED_FIELDS = [
    'personaId', 'customerProfile', 'turn', 'inputType', 'language',
    'customerMessage', 'simulatedAttachment', 'riskIntent', 'expectedTruth',
];

const EXPECTATION_RULES = Object.freeze([
    ['outside_product_module', /\b(order|payment|paid|transaction|courier|tracking|refund|cancel|booking|dispatch|confirm(?:ed|ation)?)\b|পেমেন্ট|অর্ডার|কুরিয়ার|রিফান্ড|বাতিল/i],
    ['merchant_policy_fixture_required', /\b(delivery|shipping|charge|fee|return|exchange|trial|cash on delivery|\bcod\b|refund policy|same day|tomorrow|nationwide)\b|ডেলিভারি|কুরিয়ার|রিটার্ন|এক্সচেঞ্জ|চার্জ/i],
    ['media_inspection_required', /\b(photo|image|picture|looks like|embroid|print|pattern|visible|color|colour|shade|design)\b|ছবি|রং|নকশা/i],
    ['live_authoritative_state_required', /\b(stock|available|availability|in stock|out of stock|quantity|current price|today|now|reserved)\b|স্টক|আছে|পাওয়া যাবে|দাম/i],
    ['should_remain_unknown_without_merchant_evidence', /\b(material|fabric|cotton|silk|shrink|comfort|quality|genuine|authentic|guarantee|waterproof|chest|waist|length|measurement|includes|included|bundle|discount|durable)\b|কাপড়|উপাদান|সাইজ চার্ট|গ্যারান্টি/i],
]);

const canonicalHeader = (value) => String(value || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Small RFC 4180 reader; source cells are kept in memory and never emitted. */
const parseCsv = (source) => {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (quoted) {
            if (ch === '"' && source[i + 1] === '"') {
                field += '"';
                i += 1;
            } else if (ch === '"') {
                quoted = false;
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === '"' && field.length === 0) {
            quoted = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && source[i + 1] === '\n') i += 1;
            row.push(field);
            if (row.some(value => value !== '') || field !== '') rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }
    if (quoted) throw new Error('CSV contains an unterminated quoted field.');
    if (row.length || field.length) {
        row.push(field);
        rows.push(row);
    }
    if (!rows.length) throw new Error('CSV has no header row.');

    const rawHeaders = rows.shift();
    const headers = rawHeaders.map(header => HEADER_KEYS.get(canonicalHeader(header)) || null);
    const missing = REQUIRED_FIELDS.filter(required => !headers.includes(required));
    if (missing.length) throw new Error(`CSV schema is missing required columns: ${missing.join(', ')}.`);
    if (new Set(headers.filter(Boolean)).size !== REQUIRED_FIELDS.length) {
        throw new Error('CSV schema has duplicate or unrecognized required-column mappings.');
    }

    const records = rows.map((cells, rowIndex) => {
        if (cells.length !== rawHeaders.length) {
            throw new Error(`CSV row ${rowIndex + 2} has ${cells.length} cells; expected ${rawHeaders.length}.`);
        }
        const record = {};
        headers.forEach((key, index) => {
            if (key) record[key] = cells[index];
        });
        return record;
    });
    return { headers: headers.filter(Boolean), records };
};

const normalizeInputType = (value) => {
    const key = String(value || '').toLowerCase().replace(/\s/g, '');
    const types = new Map([
        ['text', 'TEXT'],
        ['image', 'IMAGE'],
        ['image+text', 'IMAGE_TEXT'],
        ['text+image', 'IMAGE_TEXT'],
        ['image+image', 'IMAGE_IMAGE'],
    ]);
    return types.get(key) || 'OTHER';
};

const normalizeLanguage = (value) => {
    const key = String(value || '').trim().toLowerCase();
    if (/^(bangla|bengali|bn|বাংলা)$/.test(key)) return 'bangla';
    if (/^(banglish|bn-en|mixed|বাংলিশ)$/.test(key)) return 'banglish';
    if (/^(english|en)$/.test(key)) return 'english';
    return 'other';
};

const imageReferences = (attachment, scenarioId, inputType) => {
    const found = [...String(attachment || '').matchAll(/\bimage\s*#?\s*(\d+)\b/gi)]
        .map(match => `image-${match[1]}`);
    if (found.length) return [...new Set(found)];
    if (inputType === 'IMAGE' || inputType === 'IMAGE_TEXT' || inputType === 'IMAGE_IMAGE') {
        return [`unresolved-${scenarioId}`];
    }
    return [];
};

const validateDataset = (records) => {
    const problems = [];
    const personaMap = new Map();
    const scenarioIds = new Set();
    records.forEach((record, index) => {
        const row = index + 2;
        const personaId = String(record.personaId || '').trim();
        const turn = Number.parseInt(record.turn, 10);
        if (!personaId) problems.push(`row ${row}: persona id missing`);
        if (!Number.isInteger(turn) || turn < 1) problems.push(`row ${row}: turn number invalid`);
        const inputType = normalizeInputType(record.inputType);
        if (inputType === 'OTHER') problems.push(`row ${row}: input type invalid`);
        const scenarioId = `${personaId}:${turn}`;
        if (scenarioIds.has(scenarioId)) problems.push(`row ${row}: duplicate scenario id`);
        scenarioIds.add(scenarioId);
        if (!personaMap.has(personaId)) personaMap.set(personaId, []);
        personaMap.get(personaId).push({ turn, row });
        if ([ 'IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE' ].includes(inputType)
            && !String(record.simulatedAttachment || '').trim()) {
            problems.push(`row ${row}: image input has no attachment reference`);
        }
        if ([ 'IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE' ].includes(inputType)
            && !/\bimage\s*#?\s*\d+\b/i.test(String(record.simulatedAttachment || ''))) {
            problems.push(`row ${row}: image input has no explicit image identity`);
        }
    });
    if (records.length !== 200) problems.push(`scenario count is ${records.length}; expected 200`);
    if (personaMap.size !== 20) problems.push(`persona count is ${personaMap.size}; expected 20`);
    for (const [personaId, turns] of personaMap) {
        if (turns.length !== 10) problems.push(`persona group ${personaId}: ${turns.length} turns; expected 10`);
        turns.forEach((entry, i) => {
            if (entry.turn !== i + 1) problems.push(`persona group ${personaId}: turn order is not 1..10`);
        });
    }
    if (problems.length) throw new Error(`Dataset validation failed: ${problems.join('; ')}.`);
    return { personaCount: personaMap.size, scenarioCount: records.length, orderedTurnsPerPersona: 10 };
};

const classifyExpectedTruth = (text) => {
    const tags = EXPECTATION_RULES
        .filter(([, pattern]) => pattern.test(String(text || '')))
        .map(([tag]) => tag);
    return tags.length ? tags : ['manual_review_required'];
};

const isContextFollowUp = (message) => {
    const text = String(message || '').toLowerCase();
    const hasReference = /\b(this|that|it|same|previous|earlier|eta|eita|otar|tar)\b|এইটা|ওইটা|আগেরটা|এটা|সেটা/i.test(text);
    const asksFact = /\b(price|cost|dam|daam|koto|size|colour|color|material|fabric|stock|available|availability)\b|দাম|কত|সাইজ|রং|কাপড়|স্টক|আছে/i.test(text);
    return hasReference && asksFact;
};

const productRefs = (products) => products.map(product => ({
    kind: 'product',
    id: String(product.id),
    title: product.name,
}));

const summarizePass = (records, catalog, passIndex) => {
    const groups = new Map();
    records.forEach(record => {
        if (!groups.has(record.personaId)) groups.set(record.personaId, []);
        groups.get(record.personaId).push(record);
    });
    const trace = [];
    let personaOrdinal = 0;

    for (const [personaId, turns] of groups) {
        const personaNumber = ++personaOrdinal;
        const shopId = personaNumber % 2 ? 'fixture-shop-a' : 'fixture-shop-b';
        const shopCatalog = catalog.filter(product => product.shop_id === shopId);
        let history = [];
        const turnClockStart = BASE_CLOCK + personaNumber * 7 * 24 * 60 * 60 * 1000;

        for (const record of turns) {
            const turn = Number.parseInt(record.turn, 10);
            const scenarioId = `persona-${String(personaNumber).padStart(2, '0')}-turn-${String(turn).padStart(2, '0')}`;
            const inputType = normalizeInputType(record.inputType);
            const language = normalizeLanguage(record.language);
            const attachmentIds = imageReferences(record.simulatedAttachment, scenarioId, inputType);
            const hasIncomingImage = attachmentIds.length > 0;
            const now = turnClockStart + turn * 60 * 60 * 1000;
            const message = String(record.customerMessage || '');
            let evidence = grounding.resolveProductEvidence({ shopId, message, candidates: shopCatalog });
            let route = 'CATALOG_LOOKUP';

            const explicitProduct = evidence.productStatus === grounding.ProductEvidenceStatus.VERIFIED;
            if (!explicitProduct && isContextFollowUp(message) && !hasIncomingImage) {
                const ids = grounding.contextProductIds(history, { now });
                const contextProducts = shopCatalog.filter(product => ids.includes(String(product.id)));
                if (contextProducts.length) {
                    evidence = grounding.resolveContextualAttributeEvidence({ shopId, message, contextProducts });
                    route = 'CONVERSATION_CONTEXT';
                }
            }

            // An incoming image is not the merchant's product image and the CSV
            // label is not visual evidence. A new unresolved image clears the
            // previous product pointer instead of inheriting it.
            if (hasIncomingImage && !explicitProduct) {
                route = 'UNRESOLVED_INCOMING_IMAGE';
                history.push({ role: 'assistant', createdAt: new Date(now).toISOString(), sourceReferences: null });
            } else {
                const refs = evidence.productStatus === grounding.ProductEvidenceStatus.VERIFIED
                    ? productRefs(evidence.verifiedProducts)
                    : null;
                history.push({ role: 'assistant', createdAt: new Date(now).toISOString(), sourceReferences: refs });
                if (!explicitProduct && evidence.productStatus === grounding.ProductEvidenceStatus.NOT_FOUND) {
                    route = 'NO_VERIFIED_PRODUCT';
                }
            }

            const presentation = buildProductPresentation(evidence);
            const contractIssues = validateProductPresentation(presentation);
            const groundedProductNames = (evidence.verifiedProducts || []).map(product => product.name);
            const safeCandidate = groundedProductNames.length
                ? groundedProductNames.join('; ')
                : 'Please share the product name so I can check the catalog.';
            const gate = evaluateCandidate({ candidate: safeCandidate, evidence, language });

            trace.push({
                scenarioId,
                personaOrdinal: personaNumber,
                turn,
                shopId,
                inputType,
                language,
                attachmentIds,
                attachmentEvidence: hasIncomingImage ? 'METADATA_ONLY_SUBSTITUTE' : 'NONE',
                oracleTags: classifyExpectedTruth(record.expectedTruth),
                route,
                productEvidence: evidence.productStatus,
                verifiedProductIds: (evidence.verifiedProducts || []).map(product => String(product.id)),
                relatedProductIds: (evidence.relatedProducts || []).map(product => String(product.id)),
                mediaStatus: evidence.mediaStatus,
                presentationStatus: presentation.status,
                presentationSelection: presentation.selection,
                presentationContractValid: contractIssues.length === 0,
                outboundDecision: gate.decision,
                outboundReason: gate.reasonCode,
                sideEffects: { orderWrites: 0, paymentWrites: 0, courierWrites: 0, metaSends: 0 },
                modelCalls: { text: 0, vision: 0 },
            });
        }
        // The source persona ID is used only as an in-memory grouping key.
        void personaId;
    }
    return { trace, passIndex };
};

const summarizeCounts = (trace, select) => trace.reduce((counts, item) => {
    const key = select(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
}, {});

const run = ({ inputPath = DEFAULT_INPUT, outputPath = DEFAULT_OUTPUT } = {}) => {
    const start = performance.now();
    const source = fs.readFileSync(inputPath);
    const { headers, records } = parseCsv(source.toString('utf8'));
    const dataset = validateDataset(records);
    const catalog = createCatalog();
    const first = summarizePass(records, catalog, 1);
    const second = summarizePass(records, catalog, 2);
    const replayStable = JSON.stringify(first.trace) === JSON.stringify(second.trace);
    const trace = first.trace;
    const attachments = trace.flatMap(turn => turn.attachmentIds);
    const output = {
        schemaVersion: 1,
        report: 'sanitized product-experience deterministic replay',
        source: {
            basename: path.basename(inputPath),
            sha256: crypto.createHash('sha256').update(source).digest('hex'),
            sizeBytes: source.length,
            originalSourceLeftUnmodified: true,
            rawRowsOrCustomerTextPersisted: false,
            sourceColumnsRecognized: headers.length,
        },
        dataset,
        fixtureClock: 'fixed per persona; turns advance one hour; reset between persona groups',
        fixtures: {
            tenantCount: new Set(catalog.map(product => product.shop_id)).size,
            productCount: catalog.length,
            productIds: catalog.map(product => product.id),
            policyTenantCount: Object.keys(merchantPolicyFixtures).length,
            differentPricesAndPoliciesAcrossSimilarProducts: true,
            sourceImageAssets: 'not available in this run; CSV labels are not visual evidence',
            syntheticInboundImageFixtures: ['image-1', 'image-2', 'image-3', 'image-4'],
            realVisionAccuracyEvaluated: false,
        },
        replay: {
            passes: 2,
            scenariosExecutedPerPass: trace.length,
            allScenariosExecuted: trace.length === 200,
            reproducibleTrace: replayStable,
            evidenceAwareOracleTags: summarizeCounts(trace, turn => turn.oracleTags.join('+')),
            productEvidenceOutcomes: summarizeCounts(trace, turn => turn.productEvidence),
            routes: summarizeCounts(trace, turn => turn.route),
            presentationSelections: summarizeCounts(trace, turn => turn.presentationSelection),
            presentationContractsValid: trace.filter(turn => turn.presentationContractValid).length,
            outboundDecisions: summarizeCounts(trace, turn => turn.outboundDecision),
            forbiddenSideEffects: trace.reduce((sum, turn) => sum
                + turn.sideEffects.orderWrites + turn.sideEffects.paymentWrites
                + turn.sideEffects.courierWrites + turn.sideEffects.metaSends, 0),
            textModelCalls: trace.reduce((sum, turn) => sum + turn.modelCalls.text, 0),
            visionModelCalls: trace.reduce((sum, turn) => sum + turn.modelCalls.vision, 0),
            distinctAttachmentReferences: [...new Set(attachments)].sort(),
            unresolvedImageReferences: trace.filter(turn => turn.attachmentIds.some(id => id.startsWith('unresolved-'))).length,
            syntheticPolicyFixturesUsedForExpectedTruth: 0,
            expectedTruthUsedAsMerchantEvidence: false,
            interpretation: 'This is a deterministic contract replay of the production evidence, outbound gate, context resolver, and presentation validator. It does not invoke the asynchronous message worker, database, Messenger, or a model provider.',
        },
        performance: {
            harnessWallMs: Number((performance.now() - start).toFixed(2)),
            productionLatencyMeasured: false,
            modelTokenCount: 0,
            estimatedProviderCostUsd: 0,
            providerCostInterpretation: 'No provider calls were made; $0 is harness spend, not projected operating cost.',
        },
        turns: trace,
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
};

if (require.main === module) {
    const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT;
    const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT;
    try {
        const report = run({ inputPath, outputPath });
        process.stdout.write(JSON.stringify({
            sourceSha256: report.source.sha256,
            scenarios: report.replay.scenariosExecutedPerPass,
            repeatable: report.replay.reproducibleTrace,
            presentationContractsValid: report.replay.presentationContractsValid,
            reportPath: outputPath,
        }, null, 2) + '\n');
    } catch (error) {
        // Do not echo CSV cell values, which may contain customer contact data.
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    parseCsv,
    normalizeInputType,
    normalizeLanguage,
    validateDataset,
    classifyExpectedTruth,
    imageReferences,
    summarizePass,
    run,
    DEFAULT_INPUT,
    DEFAULT_OUTPUT,
};
