'use strict';

process.env.NODE_ENV = 'test';
process.env.INTENT_ROUTER_DISABLED = 'false';
process.env.AI_VISION_ENABLED = 'false';
process.env.AI_PHOTO_MATCH_ENABLED = 'false';
for (const key of [
    'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY',
    'META_ACCESS_TOKEN', 'FACEBOOK_ACCESS_TOKEN', 'SLACK_ALERT_WEBHOOK_URL', 'SENTRY_DSN',
]) delete process.env[key];

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createCatalog } = require('./fixtures');
const { buildDatasetIndex, classifyOracleTurn } = require('./lab-contracts');

const mockCatalog = createCatalog();
let mockExpectedShopId = null;
let mockTenantViolations = 0;
let mockUnscopedReads = 0;
let mockLlmChat = jest.fn(async () => ({
    text: 'The price is ৳9,999 and delivery is guaranteed tomorrow.',
    provider: 'fake-test-provider',
}));
const mockSearch = jest.fn(async ({ shopId }) => {
    if (!shopId) { mockUnscopedReads += 1; return []; }
    if (shopId !== mockExpectedShopId) { mockTenantViolations += 1; return []; }
    return mockCatalog.filter(product => product.shop_id === shopId);
});
const mockGetByIds = jest.fn(async (ids, shopId) => {
    if (!shopId) { mockUnscopedReads += 1; return []; }
    if (shopId !== mockExpectedShopId) { mockTenantViolations += 1; return []; }
    return mockCatalog.filter(product => product.shop_id === shopId && ids.map(String).includes(String(product.id)));
});
const mockRecordReadAction = jest.fn(async () => ({ recorded: false }));
const mockPhotoMatch = jest.fn(() => false);
const mockStripImages = jest.fn(messages => messages.map(message => {
    if (!Array.isArray(message.content)) return message;
    const visible = message.content.filter(block => block?.type !== 'image_url')
        .map(block => block?.text || '').filter(Boolean).join('\n');
    return { ...message, content: visible || '[the customer sent a photo]' };
}));

jest.mock('src/config/memory-cache', () => ({ MemoryCache: class { async get() { return null; } async setex() { return 'OK'; } async del() { return 1; } } }));
jest.mock('src/utils/shop-settings-cache', () => ({ getShopSettingsGeneration: jest.fn(async () => 0) }));
jest.mock('src/modules/ai/llm.service', () => ({ chat: (...args) => mockLlmChat(...args) }));
jest.mock('src/modules/ai/bert-client.service', () => ({ classify: jest.fn(async () => null) }));
jest.mock('src/modules/ai/gemini-cache.service', () => ({ getOrCreate: jest.fn(async () => null) }));
jest.mock('src/modules/ai/vision-policy.service', () => ({
    photoMatchEnabled: (...args) => mockPhotoMatch(...args),
    stripImageBlocks: (...args) => mockStripImages(...args),
}));
jest.mock('src/modules/ai/action-gate', () => ({ recordReadAction: (...args) => mockRecordReadAction(...args) }));
jest.mock('src/modules/knowledge/knowledge.service', () => ({ incrementFaqHit: jest.fn() }));
jest.mock('src/modules/product/product-search.service', () => ({
    searchByAttributes: (...args) => mockSearch(...args),
    getProductsByIds: (...args) => mockGetByIds(...args),
}));
jest.mock('src/modules/rag/rag.service', () => ({ queryData: jest.fn(async () => ({ success: true, results: [] })) }));
jest.mock('src/modules/entities', () => ({
    Conversation: { findOne: jest.fn(async () => null) },
    Order: { findOne: jest.fn(async () => null) },
    FaqResponse: { findAll: jest.fn(async () => []), findOne: jest.fn(async () => null) },
}));

const routerModuleName = process.env.LAB_ROUTER_MODULE || 'src/modules/ai/intent-router.service';
if (process.env.LAB_ROUTER_MODULE && !/^src\/modules\/ai\/intent-router\.lab-baseline-[a-f0-9-]{36}$/i.test(routerModuleName)) {
    throw new Error('Replay router module is outside the fixed baseline contract.');
}
const { route } = require(routerModuleName);
const grounding = require('src/modules/ai/grounding');
const { buildProductPresentation, validateProductPresentation } = require('src/modules/ai/product-experience/product-presentation');
const { parseCsv, normalizeInputType, normalizeLanguage, imageReferences, DEFAULT_INPUT } = require('./replay');

const OUTPUT_ROOT = path.resolve(__dirname, '../../../docs/ai/product-experience-v1-1/artifacts/runs');
const TRIAGE_ROOT = path.resolve(__dirname, '../../../docs/ai/product-experience-v1-1/artifacts/triage');
const ID_PATTERN = /^[a-f0-9-]{36}$/i;
const routerLanguage = language => language === 'english' ? 'en' : language === 'bangla' ? 'bn' : 'mixed';
const aggregate = (items, select) => items.reduce((result, item) => {
    const key = select(item);
    result[key] = (result[key] || 0) + 1;
    return result;
}, {});
const percentile = (values, fraction) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : 0;
};
const responseContainsValue = (response, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(response || '').replace(/[\s,]/g, '').includes(String(value));
    }
    const normalize = text => String(text || '').toLocaleLowerCase().replace(/[_-]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
    return normalize(response).includes(normalize(value));
};

const actualOracleValue = (turn, presentation) => {
    const product = presentation.products.find(candidate => String(candidate.id) === String(turn.oracle.productId));
    if (!product) return null;
    switch (turn.field) {
        case 'identity': return product.title;
        case 'price': return product.price.state === 'KNOWN' && product.price.currency === 'BDT' ? product.price.amount : null;
        case 'material': return product.attributes.material.state === 'KNOWN' ? product.attributes.material.value : null;
        case 'color': return product.attributes.color.state === 'KNOWN' ? product.attributes.color.value : null;
        case 'stock': return product.attributes.stock.state === 'KNOWN' ? product.attributes.stock.value : null;
        case 'variant': return product.selectedVariant?.value || null;
        case 'variant_stock': {
            const variant = product.variants.find(item => String(item.id) === String(turn.oracle.selectedVariantId));
            return variant?.availability.state === 'KNOWN' ? variant.availability.value : null;
        }
        default: return null;
    }
};

const runTargetedProductEvaluation = async () => {
    const cases = [
        { id: 'identity', tenantId: 'merchant-a', shopId: 'fixture-shop-a', message: 'Tell me about the Test Everyday T-Shirt.' },
        { id: 'price-tenant-a', tenantId: 'merchant-a', shopId: 'fixture-shop-a', message: 'How much is the Test Everyday T-Shirt?' },
        { id: 'stock-tenant-b', tenantId: 'merchant-b', shopId: 'fixture-shop-b', message: 'Is the Test Everyday T-Shirt in stock?' },
        { id: 'price-tenant-b', tenantId: 'merchant-b', shopId: 'fixture-shop-b', message: 'What is the price of the Test Everyday T-Shirt?' },
        { id: 'variant-stock-tenant-a', tenantId: 'merchant-a', shopId: 'fixture-shop-a', message: 'Is the Classic Blue Denim Jacket XL size in stock?' },
        { id: 'variant-price-tenant-b', tenantId: 'merchant-b', shopId: 'fixture-shop-b', message: 'What is the price of the Classic Blue Denim Jacket L size?' },
        { id: 'unknown-material', tenantId: 'merchant-b', shopId: 'fixture-shop-b', message: 'What material is the Test Everyday T-Shirt made from?' },
    ];
    const results = [];
    for (const item of cases) {
        const record = { customerMessage: item.message, inputType: 'Text', language: 'English' };
        const oracle = classifyOracleTurn(record, item.shopId, mockCatalog, null);
        const shopId = item.shopId;
        const started = performance.now();
        mockExpectedShopId = shopId;
        let routed;
        try {
            routed = await route({
                shopId,
                message: item.message,
                conversationId: `lab-targeted-${item.id}`,
                history: [],
                language: 'en',
                systemPrompt: 'Synthetic local test merchant. Use only verified catalog evidence. This is an offline test fixture.',
                imageUrls: [],
                traceId: `targeted-${item.id}`,
                now: new Date('2026-10-20T00:00:00.000Z'),
            });
        } finally {
            mockExpectedShopId = null;
        }
        const evidence = routed.grounding || grounding.emptyEvidence(shopId);
        const presentation = buildProductPresentation(evidence, { message: item.message, language: 'en' });
        const verdict = grounding.evaluateCandidate({ candidate: routed.response, evidence, language: 'en', modelGenerated: grounding.isModelGenerated(routed.source) });
        const slots = oracle.eligibleSlots.map(slot => {
            const actualValue = actualOracleValue({ ...slot, oracle }, presentation);
            return {
                field: slot.field,
                expectedValue: slot.expectedValue,
                actualValue,
                correct: actualValue !== null && String(actualValue).toLocaleLowerCase() === String(slot.expectedValue).toLocaleLowerCase(),
                presentInResponse: actualValue !== null && responseContainsValue(verdict.text || routed.response, actualValue),
            };
        });
        results.push({
            caseId: item.id,
            tenantId: item.tenantId,
            eligibility: oracle.eligibility,
            answerableSlots: slots.length,
            disposition: verdict.decision,
            reasonCode: verdict.reasonCode || null,
            routerSource: routed.source || 'unknown',
            correctFactSlots: slots.filter(slot => slot.correct && slot.presentInResponse && verdict.decision === grounding.GroundingDecision.SEND).length,
            factSlots: slots,
            unknownRequestedFields: oracle.unknownRequestedFields || [],
            evidenceStatus: evidence.productStatus || 'NONE',
            evidenceProductIds: (evidence.verifiedProducts || []).map(product => String(product.id)),
            tenantEvidenceOnly: (evidence.verifiedProducts || []).every(product => String(product.shopId || product.shop_id) === shopId),
            presentationContractValid: validateProductPresentation(presentation).length === 0,
            latencyMs: Number((performance.now() - started).toFixed(3)),
        });
    }
    const answerable = results.filter(result => result.eligibility === 'ANSWERABLE');
    const eligibleSlots = results.reduce((sum, result) => sum + result.answerableSlots, 0);
    const correctSlots = results.reduce((sum, result) => sum + result.correctFactSlots, 0);
    return {
        provenance: 'fixed synthetic cases; independent evidence oracle; production router and grounding gate; mock provider; no external calls',
        caseCount: results.length,
        answerableCaseCount: answerable.length,
        eligibleFactSlots: eligibleSlots,
        correctFactSlots: correctSlots,
        factAccuracy: eligibleSlots ? correctSlots / eligibleSlots : null,
        tenantIsolationPass: results.every(result => result.tenantEvidenceOnly),
        presentationContractPass: results.every(result => result.presentationContractValid),
        allCases: results,
    };
};

const runUnsafePriceCanary = async () => {
    const shopId = 'fixture-shop-a';
    const message = 'How much is the Test Everyday T-Shirt?';
    mockExpectedShopId = shopId;
    let routed;
    try {
        routed = await route({
            shopId,
            message,
            conversationId: 'lab-triage-synthetic-case',
            history: [],
            language: 'en',
            systemPrompt: 'Synthetic local test merchant. Use only verified catalog evidence. This is an offline test fixture.',
            imageUrls: [],
            traceId: 'unsafe-price-claim',
            now: new Date('2026-10-20T00:00:00.000Z'),
        });
    } finally {
        mockExpectedShopId = null;
    }
    const evidence = routed.grounding || grounding.emptyEvidence(shopId);
    const candidate = 'The price is ৳450 at a 50% discount, and delivery is guaranteed tomorrow.';
    const verdict = grounding.evaluateCandidate({ candidate, evidence, language: 'en', modelGenerated: true });
    return {
        fixtureId: 'unsafe-price-claim',
        severity: 'P1',
        status: verdict.decision === grounding.GroundingDecision.SEND ? 'UNSAFE_CLAIM_SENT' : 'BLOCKED_BY_GROUNDING',
        blocked: verdict.decision !== grounding.GroundingDecision.SEND,
        disposition: verdict.decision,
        reasonCode: verdict.reasonCode || null,
        evidenceProductIds: (evidence.verifiedProducts || []).map(product => String(product.id)),
        evidenceFields: ['price', 'stock', 'merchant policy'],
        providerMode: 'mock-adversarial-candidate',
        externalCalls: 0,
    };
};

const executeTriage = async () => {
    const resultPath = path.resolve(process.env.LAB_TRIAGE_RESULT_PATH || '');
    const fixtureId = process.env.LAB_TRIAGE_FIXTURE_ID;
    if (fixtureId !== 'unsafe-price-claim' || !resultPath.startsWith(`${TRIAGE_ROOT}${path.sep}`)
        || !/^[a-f0-9-]{36}\.json$/i.test(path.basename(resultPath))) {
        throw new Error('Triage request is outside the fixed local contract.');
    }
    const artifact = {
        runId: process.env.LAB_RUN_ID,
        fixtureId,
        status: 'completed',
        sourceRevision: process.env.LAB_SOURCE_REVISION || 'unknown',
        engineSourceRevision: process.env.LAB_ENGINE_SOURCE_REVISION || 'unknown',
        engineSourceSha256: process.env.LAB_ENGINE_SOURCE_SHA256 || null,
        runnerRevision: process.env.LAB_RUNNER_REVISION || 'working-tree',
        runnerSourceSha256: process.env.LAB_RUNNER_SOURCE_SHA256 || null,
        candidate: await runUnsafePriceCanary(),
        provenance: { execution: 'production-router-and-grounding-gate', modelProvider: 'mock', externalCalls: 0, rawCandidatePersisted: false },
    };
    fs.mkdirSync(TRIAGE_ROOT, { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(artifact)}\n`, { encoding: 'utf8', mode: 0o600 });
    return artifact;
};

const executePlayground = async () => {
    const inputPath = path.resolve(process.env.LAB_PLAYGROUND_INPUT_PATH || '');
    const resultPath = path.resolve(process.env.LAB_PLAYGROUND_RESULT_PATH || '');
    const tempRoot = `${path.resolve(require('node:os').tmpdir())}${path.sep}`;
    if (!inputPath.startsWith(tempRoot) || path.basename(inputPath) !== 'input.json'
        || !path.basename(path.dirname(inputPath)).startsWith('easymod-lab-playground-')) {
        throw new Error('Playground input path is outside the private temporary directory.');
    }
    if (!resultPath.startsWith(`${OUTPUT_ROOT}${path.sep}`) || !/^[a-f0-9-]{36}\.playground\.json$/i.test(path.basename(resultPath))) {
        throw new Error('Playground result path is outside the fixed artifact directory.');
    }
    const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const { validatePlaygroundRequest } = require('./lab-contracts');
    const allowedKeys = new Set(['tenantId', 'sessionId', 'message', 'imageFixtureId', 'history', 'turnIndex']);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !allowedKeys.has(key))) {
        throw new Error('Playground payload contains an unsupported field.');
    }
    const input = validatePlaygroundRequest({
        tenantId: raw.tenantId,
        sessionId: raw.sessionId,
        message: raw.message,
        ...(Object.hasOwn(raw, 'imageFixtureId') ? { imageFixtureId: raw.imageFixtureId } : {}),
    });
    if (!Array.isArray(raw.history) || raw.history.length > 40 || !Number.isInteger(raw.turnIndex) || raw.turnIndex < 0 || raw.turnIndex > 100) {
        throw new Error('Playground context is outside the bounded local contract.');
    }
    const history = raw.history.map(item => {
        if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 1200) {
            throw new Error('Playground history contains an invalid message.');
        }
        return { role: item.role, content: item.content, ...(item.createdAt ? { createdAt: item.createdAt } : {}) };
    });
    const shopId = input.tenantId === 'merchant-a' ? 'fixture-shop-a' : 'fixture-shop-b';
    const imageUrls = input.imageFixtureId ? [`https://fixtures.invalid/${input.imageFixtureId}.png`] : [];
    mockExpectedShopId = shopId;
    let result;
    const started = performance.now();
    try {
        result = await route({
            shopId,
            message: input.message,
            conversationId: 'lab-playground-synthetic-session',
            history,
            language: 'mixed',
            systemPrompt: 'Synthetic local test merchant. Use only verified catalog evidence. This is an offline test fixture.',
            imageUrls,
            traceId: process.env.LAB_RUN_ID,
            now: new Date(),
        });
    } finally {
        mockExpectedShopId = null;
    }
    const evidence = result.grounding || grounding.emptyEvidence(shopId);
    const presentation = buildProductPresentation(evidence, { message: input.message, language: 'mixed' });
    const verdict = grounding.evaluateCandidate({
        candidate: result.response,
        evidence,
        language: 'mixed',
        modelGenerated: grounding.isModelGenerated(result.source),
    });
    const resultArtifact = {
        operation: 'playground',
        status: 'completed',
        sourceRevision: process.env.LAB_SOURCE_REVISION || 'unknown',
        engineSourceRevision: process.env.LAB_ENGINE_SOURCE_REVISION || 'unknown',
        engineSourceSha256: process.env.LAB_ENGINE_SOURCE_SHA256 || null,
        runnerRevision: process.env.LAB_RUNNER_REVISION || 'working-tree',
        runnerSourceSha256: process.env.LAB_RUNNER_SOURCE_SHA256 || null,
        tenantId: input.tenantId,
        turnIndex: raw.turnIndex + 1,
        disposition: verdict.decision,
        reasonCode: verdict.reasonCode || null,
        latencyMs: Number((performance.now() - started).toFixed(3)),
        productEvidence: {
            status: evidence.productStatus || 'NONE',
            productIds: (evidence.verifiedProducts || []).map(product => String(product.id)),
        },
        contextProductId: (evidence.verifiedProducts || []).length === 1 ? String(evidence.verifiedProducts[0].id) : null,
        productFacts: presentation.products.map(product => ({
            id: String(product.id),
            name: product.name,
            price: product.price,
            attributes: product.attributes,
            selectedVariant: product.selectedVariant,
        })),
        presentation: { status: presentation.status, selection: presentation.selection, contractValid: validateProductPresentation(presentation).length === 0 },
        provider: { mode: 'mock', calls: mockLlmChat.mock.calls.length, actualProviderUsage: false },
        provenance: { router: 'production-intent-router', catalog: 'synthetic-fixture-snapshot', externalCalls: 0, vision: 'disabled' },
    };
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(resultArtifact)}\n`, { encoding: 'utf8', mode: 0o600 });
    return resultArtifact;
};

const stableScenario = (personaOrdinal, turn) => `scenario-${String(personaOrdinal).padStart(2, '0')}-${String(turn).padStart(2, '0')}`;
const dataPath = process.env.LAB_DATASET_PATH || DEFAULT_INPUT;
const runId = process.env.LAB_RUN_ID || crypto.randomUUID();
const scope = process.env.LAB_RUN_SCOPE || 'full';
const mode = process.env.LAB_RUN_MODE || 'candidate';
const personaId = process.env.LAB_PERSONA_ID || null;
const resultPath = process.env.LAB_RESULT_PATH || path.join(OUTPUT_ROOT, `${runId}.json`);
const progressPath = process.env.LAB_PROGRESS_PATH || path.join(OUTPUT_ROOT, `${runId}.progress.json`);

const writeProgress = (completed, total) => {
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    const progress = { runId, completed, total, updatedAt: new Date().toISOString() };
    fs.writeFileSync(progressPath, `${JSON.stringify(progress)}\n`, { encoding: 'utf8', mode: 0o600 });
};

describe('Product Engine local Test Lab route replay', () => {
    jest.setTimeout(180000);

    test('executes the selected source turns sequentially through the production router and grounding gate', async () => {
        if (process.env.LAB_OPERATION === 'triage') {
            const receipt = await executeTriage();
            expect(receipt.provenance.externalCalls).toBe(0);
            return;
        }
        if (process.env.LAB_OPERATION === 'playground') {
            const receipt = await executePlayground();
            expect(receipt.status).toBe('completed');
            expect(receipt.provenance.externalCalls).toBe(0);
            return;
        }
        if (!ID_PATTERN.test(runId)) throw new Error('Lab run identifier is invalid.');
        const resolvedOutput = path.resolve(resultPath);
        const resolvedProgress = path.resolve(progressPath);
        if (!resolvedOutput.startsWith(`${OUTPUT_ROOT}${path.sep}`) || !resolvedProgress.startsWith(`${OUTPUT_ROOT}${path.sep}`)) {
            throw new Error('Lab artifact path is outside the fixed output directory.');
        }
        if (!['full', 'persona'].includes(scope) || !['baseline', 'candidate'].includes(mode)) throw new Error('Lab run mode is invalid.');
        const source = fs.readFileSync(dataPath);
        const dataset = buildDatasetIndex(source);
        const parsed = parseCsv(source.toString('utf8'));
        const personaIds = [...new Set(parsed.records.map(record => String(record.personaId).trim()))];
        const selectedOrdinal = personaId ? Number(String(personaId).slice(1)) : null;
        if (scope === 'persona' && (!Number.isInteger(selectedOrdinal) || selectedOrdinal < 1 || selectedOrdinal > 20)) {
            throw new Error('Lab persona selection is invalid.');
        }
        if (scope === 'full' && personaId) throw new Error('Full run cannot be filtered to one persona.');
        const groups = new Map();
        parsed.records.forEach(record => {
            const key = String(record.personaId).trim();
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(record);
        });
        const selectedGroups = [...groups.entries()].filter(([, turns], index) => scope === 'full' || index + 1 === selectedOrdinal);
        if (scope === 'persona' && selectedGroups.length !== 1) throw new Error('Selected persona is absent from the source dataset.');

        mockLlmChat.mockClear(); mockSearch.mockClear(); mockGetByIds.mockClear();
        mockRecordReadAction.mockClear(); mockPhotoMatch.mockClear(); mockStripImages.mockClear();
        mockTenantViolations = 0; mockUnscopedReads = 0;

        const startedAt = new Date().toISOString();
        const wallStart = performance.now();
        const turnResults = [];
        const routeDurations = [];
        const oracleContext = new Map();
        let completed = 0;
        const total = selectedGroups.reduce((sum, [, turns]) => sum + turns.length, 0);
        writeProgress(0, total);

        for (let groupIndex = 0; groupIndex < selectedGroups.length; groupIndex += 1) {
            const [sourcePersonaId, turns] = selectedGroups[groupIndex];
            const personaOrdinal = personaIds.indexOf(sourcePersonaId) + 1;
            const safePersonaId = `P${String(personaOrdinal).padStart(2, '0')}`;
            const shopId = personaOrdinal % 2 ? 'fixture-shop-a' : 'fixture-shop-b';
            const history = [];
            let previousOracleProductId = null;
            let previousMatchedProductId = null;
            const clockStart = Date.parse('2026-10-20T00:00:00.000Z') + personaOrdinal * 7 * 24 * 60 * 60 * 1000;

            for (const record of turns) {
                const turnNumber = Number.parseInt(record.turn, 10);
                const scenarioId = stableScenario(personaOrdinal, turnNumber);
                const inputType = normalizeInputType(record.inputType);
                const datasetLanguage = normalizeLanguage(record.language);
                const language = routerLanguage(datasetLanguage);
                const attachmentIds = imageReferences(record.simulatedAttachment, scenarioId, inputType);
                const imageUrls = attachmentIds.map(id => `https://fixtures.invalid/${id}.png`);
                const message = String(record.customerMessage || '');
                const oracle = classifyOracleTurn(record, shopId, mockCatalog, previousOracleProductId);
                const callCountBefore = mockLlmChat.mock.calls.length;
                const actionCountBefore = mockRecordReadAction.mock.calls.length;
                const routeStarted = performance.now();
                mockExpectedShopId = shopId;
                let result;
                try {
                    result = await route({
                        shopId,
                        message,
                        conversationId: `lab-conversation-${safePersonaId}-${turnNumber}`,
                        history,
                        language,
                        systemPrompt: 'Synthetic local test merchant. Use only verified catalog evidence. This is an offline test fixture.',
                        imageUrls,
                        traceId: scenarioId,
                        now: new Date(clockStart + turnNumber * 60 * 60 * 1000),
                    });
                } finally {
                    mockExpectedShopId = null;
                }
                const routeLatencyMs = Number((performance.now() - routeStarted).toFixed(3));
                routeDurations.push(routeLatencyMs);
                const evidence = result.grounding || grounding.emptyEvidence(shopId);
                const presentation = buildProductPresentation(evidence, { message, language });
                const presentationIssues = validateProductPresentation(presentation);
                const modelGenerated = grounding.isModelGenerated(result.source);
                const verdict = grounding.evaluateCandidate({
                    candidate: result.response,
                    evidence,
                    language,
                    modelGenerated,
                });
                const rawResponse = verdict.text || result.response || '';
                const shownFacts = oracle.eligibleSlots.map(slot => ({
                    field: slot.field,
                    expectedValue: slot.expectedValue,
                    actualValue: actualOracleValue({ ...slot, oracle }, presentation),
                    evidenceId: slot.evidenceId,
                }));
                const correctSlots = shownFacts.filter(slot => verdict.decision === grounding.GroundingDecision.SEND
                    && slot.actualValue !== null
                    && String(slot.actualValue).toLocaleLowerCase() === String(slot.expectedValue).toLocaleLowerCase());
                const exactResponseValues = shownFacts.filter(slot => slot.actualValue !== null
                    && responseContainsValue(rawResponse, slot.actualValue));
                const correctAnsweredSlots = verdict.decision === grounding.GroundingDecision.SEND
                    ? correctSlots.filter(slot => exactResponseValues.some(shown => shown.field === slot.field))
                    : [];
                const unsafePriceClaims = verdict.decision === grounding.GroundingDecision.SEND
                    ? [...String(rawResponse).matchAll(/[৳$]\s*([\d,]+(?:\.\d+)?)/g)]
                        .map(match => Number(match[1].replace(/,/g, '')))
                        .filter(amount => Number.isFinite(amount) && ![...(evidence.verifiedProducts || []), ...(evidence.relatedProducts || [])].some(product => {
                            const allowed = [product.facts?.price?.value, ...(product.facts?.variants || []).map(variant => variant.price?.value)]
                                .filter(value => value != null).map(Number);
                            return allowed.includes(amount);
                        })).length
                    : 0;
                const turnTrace = {
                    scenarioId,
                    personaId: safePersonaId,
                    turn: turnNumber,
                    inputType,
                    language: datasetLanguage,
                    classificationTags: oracle.classificationTags,
                    oracle: {
                        domain: oracle.domain,
                        eligibility: oracle.eligibility,
                        productId: oracle.productId || null,
                        selectedVariantId: oracle.selectedVariantId || null,
                        eligibleSlots: oracle.eligibleSlots,
                    },
                    routerSource: result.source || 'unknown',
                    disposition: verdict.decision,
                    responseTextStored: false,
                    reasonCode: verdict.reasonCode || null,
                    productEvidence: {
                        status: evidence.productStatus || 'NONE',
                        productIds: (evidence.verifiedProducts || []).map(product => String(product.id)),
                        relatedProductIds: (evidence.relatedProducts || []).map(product => String(product.id)),
                    },
                    presentation: {
                        status: presentation.status,
                        selection: presentation.selection,
                        contractValid: presentationIssues.length === 0,
                        products: presentation.products.map(product => ({
                            id: product.id,
                            price: product.price,
                            attributes: product.attributes,
                            selectedVariant: product.selectedVariant,
                            variants: product.variants.map(variant => ({ id: variant.id, option: variant.option, value: variant.value, price: variant.price, availability: variant.availability })),
                            image: product.image.state,
                        })),
                    },
                    factScores: {
                        eligibleSlots: shownFacts.length,
                        correctEvidenceSlots: correctSlots.length,
                        correctAnsweredSlots: correctAnsweredSlots.length,
                        unnecessaryRefusalSlots: verdict.decision === grounding.GroundingDecision.SEND ? 0 : shownFacts.length,
                        incorrectOrUnansweredSlots: shownFacts.length - correctAnsweredSlots.length,
                        unsupportedPriceClaimsSent: unsafePriceClaims,
                    },
                    provider: {
                        mode: 'mock',
                        calls: mockLlmChat.mock.calls.length - callCountBefore,
                        costUsd: null,
                        actualProviderUsage: false,
                    },
                    latencyMs: routeLatencyMs,
                    traceId: scenarioId,
                    attachmentEvidence: attachmentIds.length ? 'METADATA_ONLY_NO_VISION' : 'NONE',
                    sideEffects: { databaseWrites: 0, queueJobs: 0, messengerSends: 0, readAuditCalls: mockRecordReadAction.mock.calls.length - actionCountBefore },
                };
                turnResults.push(turnTrace);
                if (oracle.productId) previousOracleProductId = oracle.productId;
                if (evidence.verifiedProducts?.length === 1) previousMatchedProductId = String(evidence.verifiedProducts[0].id);
                const contextProduct = oracle.productId || previousMatchedProductId;
                if (contextProduct) oracleContext.set(safePersonaId, contextProduct);
                const now = clockStart + turnNumber * 60 * 60 * 1000;
                history.push(
                    { role: 'user', content: message, createdAt: new Date(now).toISOString() },
                    { role: 'assistant', content: rawResponse, sourceReferences: result.sourceReferences || null, createdAt: new Date(now + 1000).toISOString() },
                );
                completed += 1;
                if (completed % 1 === 0) writeProgress(completed, total);
            }
        }

        const eligibleTurns = turnResults.filter(item => item.oracle.eligibility === 'ANSWERABLE');
        const eligibleSlots = turnResults.reduce((sum, item) => sum + item.factScores.eligibleSlots, 0);
        const correctSlots = turnResults.reduce((sum, item) => sum + item.factScores.correctAnsweredSlots, 0);
        const falseRefusalSlots = turnResults.reduce((sum, item) => sum + item.factScores.unnecessaryRefusalSlots, 0);
        const sentUnsupportedClaims = turnResults.reduce((sum, item) => sum + item.factScores.unsupportedPriceClaimsSent, 0);
        const fullyAnsweredTurns = eligibleTurns.filter(item => item.factScores.eligibleSlots > 0
            && item.factScores.correctAnsweredSlots === item.factScores.eligibleSlots).length;
        const datasetSource = dataset.source;
        const filteredCoverage = scope === 'full' && turnResults.length === datasetSource.scenarioCount;
        const targetedEvaluation = await runTargetedProductEvaluation();
        const unsafePriceCanary = await runUnsafePriceCanary();
        const artifact = {
            schemaVersion: 2,
            runId,
            scope,
            personaId,
            mode,
            status: 'completed',
            executionMode: 'production-intent-router-with-controlled-local-collaborators',
            sourceRevision: process.env.LAB_SOURCE_REVISION || 'unknown',
            engineSourceRevision: process.env.LAB_ENGINE_SOURCE_REVISION || 'c8981c4df9ea84d47c35f2541884fd55afd64bae',
            engineSourceSha256: process.env.LAB_ENGINE_SOURCE_SHA256 || null,
            runnerRevision: process.env.LAB_RUNNER_REVISION || 'working-tree',
            runnerSourceSha256: process.env.LAB_RUNNER_SOURCE_SHA256 || null,
            dataset: {
                sha256: datasetSource.sha256,
                sourceTurns: datasetSource.scenarioCount,
                sourcePersonas: datasetSource.personaCount,
                executedTurns: turnResults.length,
                completeDatasetExecuted: filteredCoverage,
                sequentialPerPersona: true,
                rawSourceMessagesPersisted: false,
            },
            provenance: {
                sourceAnswersUsedAsGroundTruth: false,
                catalogSource: 'synthetic-fixture-snapshot',
                modelProvider: 'mock-adversarial-provider',
                vision: 'disabled; attachments are metadata-only',
                realPostgres: false,
                realRedis: false,
                realWorker: false,
                realMeta: false,
                realProvider: false,
                realVision: false,
                outboundNetworkCalls: 0,
            },
            summary: {
                answerableProductTurns: eligibleTurns.length,
                correctVerifiedProductTurns: fullyAnsweredTurns,
                eligibleProductFactSlots: eligibleSlots,
                correctVerifiedProductAnswers: correctSlots,
                unnecessaryRefusalSlots: falseRefusalSlots,
                unsupportedClaimsSent: sentUnsupportedClaims,
                blockedMockUnsupportedCandidates: turnResults.filter(item => item.provider.calls > 0 && item.disposition !== grounding.GroundingDecision.SEND).length,
                safeFallbacks: turnResults.filter(item => item.disposition === grounding.GroundingDecision.SAFE_FALLBACK).length,
                dispositions: aggregate(turnResults, item => item.disposition),
                routerSources: aggregate(turnResults, item => item.routerSource),
                oracleDomains: aggregate(turnResults, item => item.oracle.domain),
                oracleEligibility: aggregate(turnResults, item => item.oracle.eligibility),
                presentationContractsValid: turnResults.filter(item => item.presentation.contractValid).length,
                tenantScopeViolations: mockTenantViolations,
                unscopedCatalogReads: mockUnscopedReads,
                realModelCalls: 0,
                mockModelCalls: mockLlmChat.mock.calls.length,
                realVisionCalls: 0,
                businessMutations: 0,
                messengerSends: 0,
            },
            targetedEvaluation,
            triageFixtures: [unsafePriceCanary],
            performance: {
                measuredLayer: 'in-process intent-router call only; controlled mock adapters',
                p50Ms: Number(percentile(routeDurations, .5).toFixed(3)),
                p95Ms: Number(percentile(routeDurations, .95).toFixed(3)),
                meanMs: Number((routeDurations.reduce((sum, value) => sum + value, 0) / Math.max(routeDurations.length, 1)).toFixed(3)),
                sampleCount: routeDurations.length,
                wallMs: Number((performance.now() - wallStart).toFixed(2)),
                costUsd: null,
                costStatus: 'NOT_MEASURED_NO_REAL_PROVIDER_CALLS',
                actualProviderUsageRecords: 0,
            },
            turns: turnResults,
            startedAt,
            completedAt: new Date().toISOString(),
        };

        const text = JSON.stringify(artifact, null, 2);
        if (text.includes('customerMessage') || text.includes('customerProfile') || text.includes('expectedTruth')
            || text.includes('simulatedAttachment') || text.includes('sourceHash') || text.includes('responsePreview')
            || text.includes('responseDigest')) throw new Error('Run artifact contains a forbidden source or free-text response field.');
        fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
        fs.writeFileSync(resolvedOutput, `${text}\n`, { encoding: 'utf8', mode: 0o600 });
        writeProgress(total, total);
        expect(turnResults.length).toBe(total);
        expect(turnResults.every(item => item.scenarioId && item.traceId)).toBe(true);
        expect(turnResults.every(item => item.presentation.contractValid)).toBe(true);
        expect(mockTenantViolations).toBe(0);
        expect(mockUnscopedReads).toBe(0);
        expect(artifact.provenance.outboundNetworkCalls).toBe(0);
        expect(artifact.summary.messengerSends).toBe(0);
    });
});
