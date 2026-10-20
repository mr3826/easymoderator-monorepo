'use strict';

process.env.NODE_ENV = 'test';
process.env.INTENT_ROUTER_DISABLED = 'false';
process.env.AI_VISION_ENABLED = 'false';
process.env.AI_PHOTO_MATCH_ENABLED = 'false';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createCatalog } = require('../../../../../scripts/product-experience/fixtures');
const mockCatalog = createCatalog();
let mockUnscopedCatalogReads = 0;
let mockTenantScopeViolations = 0;
let mockExpectedShopId = null;
const mockSearch = jest.fn(async ({ shopId }) => {
    if (!shopId) {
        mockUnscopedCatalogReads += 1;
        return [];
    }
    if (shopId !== mockExpectedShopId) {
        mockTenantScopeViolations += 1;
        return [];
    }
    return mockCatalog.filter(product => product.shop_id === shopId);
});
const mockGetByIds = jest.fn(async (ids, shopId) => {
    if (!shopId) {
        mockUnscopedCatalogReads += 1;
        return [];
    }
    if (shopId !== mockExpectedShopId) {
        mockTenantScopeViolations += 1;
        return [];
    }
    return mockCatalog.filter(product => product.shop_id === shopId && ids.map(String).includes(String(product.id)));
});
const mockLlmChat = jest.fn(async () => ({
    text: 'The price is ৳9,999 and delivery is guaranteed tomorrow.',
    provider: 'fake-test-provider',
}));
const mockRecordReadAction = jest.fn(async () => ({ recorded: false }));
const mockFaqHit = jest.fn();
const mockPhotoMatch = jest.fn(() => false);
const mockStripImages = jest.fn(messages => messages.map(message => {
    if (!Array.isArray(message.content)) return message;
    const text = message.content.filter(block => block?.type !== 'image_url')
        .map(block => block?.text || '').filter(Boolean).join('\n');
    return { ...message, content: text || '[the customer sent a photo]' };
}));

jest.mock('src/config/memory-cache', () => ({
    MemoryCache: class {
        async get() { return null; }
        async setex() { return 'OK'; }
        async del() { return 1; }
    },
}));
jest.mock('src/utils/shop-settings-cache', () => ({
    getShopSettingsGeneration: jest.fn(async () => 0),
}));
jest.mock('src/modules/ai/llm.service', () => ({ chat: (...args) => mockLlmChat(...args) }));
jest.mock('src/modules/ai/bert-client.service', () => ({ classify: jest.fn(async () => null) }));
jest.mock('src/modules/ai/gemini-cache.service', () => ({ getOrCreate: jest.fn(async () => null) }));
jest.mock('src/modules/ai/vision-policy.service', () => ({
    photoMatchEnabled: (...args) => mockPhotoMatch(...args),
    stripImageBlocks: (...args) => mockStripImages(...args),
}));
jest.mock('src/modules/ai/action-gate', () => ({ recordReadAction: (...args) => mockRecordReadAction(...args) }));
jest.mock('src/modules/knowledge/knowledge.service', () => ({ incrementFaqHit: (...args) => mockFaqHit(...args) }));
jest.mock('src/modules/product/product-search.service', () => ({
    searchByAttributes: (...args) => mockSearch(...args),
    getProductsByIds: (...args) => mockGetByIds(...args),
}));
jest.mock('src/modules/rag/rag.service', () => ({
    queryData: jest.fn(async () => ({ success: true, results: [] })),
}));
jest.mock('src/modules/entities', () => ({
    Conversation: { findOne: jest.fn(async () => null) },
    Order: { findOne: jest.fn(async () => null) },
    FaqResponse: {
        findAll: jest.fn(async () => []),
        findOne: jest.fn(async () => null),
    },
}));

const { route } = require('src/modules/ai/intent-router.service');
const grounding = require('src/modules/ai/grounding');
const {
    buildProductPresentation,
    validateProductPresentation,
} = require('src/modules/ai/product-experience/product-presentation');
const {
    parseCsv,
    normalizeInputType,
    normalizeLanguage,
    validateDataset,
    classifyExpectedTruth,
    imageReferences,
    DEFAULT_INPUT,
} = require('../../../../../scripts/product-experience/replay');

const OUTPUT_PATH = path.resolve(__dirname, '../../../../../../docs/ai/product-experience-v1/artifacts/production-router-replay.json');
const BASE_CLOCK = Date.parse('2026-10-20T00:00:00.000Z');
const PHONE_OR_EMAIL = /(?:\+?880\s*)?0?(1[3-9]\d{8})\b|[\w.+\-]+@[\w\-]+\.[a-z]{2,}/i;
const routerLanguage = language => language === 'english' ? 'en' : language === 'bangla' ? 'bn' : 'mixed';

const getPromptText = request => [request.systemPrompt || '', ...(request.messages || [])
    .map(message => typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content))].join('\n');

const aggregate = (items, select) => items.reduce((counts, item) => {
    const key = select(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
}, {});

const percentile = (values, fraction) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : 0;
};

const runPass = async (records, passIndex) => {
    const grouped = new Map();
    for (const record of records) {
        if (!grouped.has(record.personaId)) grouped.set(record.personaId, []);
        grouped.get(record.personaId).push(record);
    }

    const trace = [];
    let personaOrdinal = 0;
    let modelCalls = 0;
    let piiPatternsInProviderPrompt = 0;
    let imageScenarioCount = 0;
    let readAuditAttempts = 0;
    const routeDurationsMs = [];

    for (const turns of grouped.values()) {
        personaOrdinal += 1;
        const shopId = personaOrdinal % 2 ? 'fixture-shop-a' : 'fixture-shop-b';
        let history = [];
        const clockStart = BASE_CLOCK + personaOrdinal * 7 * 24 * 60 * 60 * 1000;

        for (const record of turns) {
            const turn = Number.parseInt(record.turn, 10);
            const syntheticConversationId = `fixture-conversation-${personaOrdinal}-${turn}`;
            const scenarioId = `scenario-${String(personaOrdinal).padStart(2, '0')}-${String(turn).padStart(2, '0')}`;
            const inputType = normalizeInputType(record.inputType);
            const datasetLanguage = normalizeLanguage(record.language);
            const language = routerLanguage(datasetLanguage);
            const attachmentIds = imageReferences(record.simulatedAttachment, scenarioId, inputType);
            const hasImage = attachmentIds.length > 0;
            if (hasImage) imageScenarioCount += 1;
            const imageUrls = attachmentIds.map(id => `https://fixtures.invalid/${id}.svg`);
            const message = String(record.customerMessage || '');
            const now = clockStart + turn * 60 * 60 * 1000;
            const providerCallCountBefore = mockLlmChat.mock.calls.length;
            const auditCountBefore = mockRecordReadAction.mock.calls.length;
            const routeStarted = performance.now();
            mockExpectedShopId = shopId;

            const result = await route({
                shopId,
                message,
                conversationId: syntheticConversationId,
                history,
                language,
                systemPrompt: 'Synthetic test shop. Use only the live catalog and shop facts provided for this test.',
                imageUrls,
                traceId: scenarioId,
            });
            mockExpectedShopId = null;
            routeDurationsMs.push(performance.now() - routeStarted);
            if (mockLlmChat.mock.calls.length > providerCallCountBefore) modelCalls += 1;
            readAuditAttempts += mockRecordReadAction.mock.calls.length - auditCountBefore;

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
            const providerPrompt = mockLlmChat.mock.calls.slice(providerCallCountBefore)
                .map(([request]) => getPromptText(request)).join('\n');
            if (providerPrompt && PHONE_OR_EMAIL.test(providerPrompt)) piiPatternsInProviderPrompt += 1;

            trace.push({
                scenarioId,
                personaOrdinal,
                turn,
                tenantFixture: shopId,
                inputType,
                language: datasetLanguage,
                attachmentIds,
                attachmentEvidence: hasImage ? 'METADATA_ONLY_SUBSTITUTE' : 'NONE',
                oracleTags: classifyExpectedTruth(record.expectedTruth),
                routerSource: result.source || 'unknown',
                productEvidence: evidence.productStatus,
                mediaStatus: evidence.mediaStatus,
                verifiedProductIds: (evidence.verifiedProducts || []).map(product => String(product.id)),
                relatedProductIds: (evidence.relatedProducts || []).map(product => String(product.id)),
                presentationStatus: presentation.status,
                presentationSelection: presentation.selection,
                presentationContractValid: presentationIssues.length === 0,
                outboundDecision: verdict.decision,
                outboundReason: verdict.reasonCode,
                modelGenerated,
                modelCallCount: mockLlmChat.mock.calls.length - providerCallCountBefore,
            });

            history.push(
                { role: 'user', content: message, createdAt: new Date(now).toISOString() },
                {
                    role: 'assistant',
                    content: verdict.text || '',
                    sourceReferences: result.sourceReferences || null,
                    createdAt: new Date(now + 1000).toISOString(),
                },
            );
        }
    }

    return {
        trace,
        passIndex,
        modelCalls,
        imageScenarioCount,
        readAuditAttempts,
        tenantScopeViolations: mockTenantScopeViolations,
        piiPatternsInProviderPrompt,
        routeDurationsMs,
    };
};

describe('production intent-router replay with local-only providers', () => {
    jest.setTimeout(120000);

    const replayTest = fs.existsSync(DEFAULT_INPUT) ? test : test.skip;
    replayTest('routes all simulator turns twice and writes only sanitized aggregate evidence', async () => {
        const started = performance.now();
        const source = fs.readFileSync(DEFAULT_INPUT);
        const { headers, records } = parseCsv(source.toString('utf8'));
        const dataset = validateDataset(records);
        mockLlmChat.mockClear();
        mockRecordReadAction.mockClear();
        mockSearch.mockClear();
        mockGetByIds.mockClear();
        mockPhotoMatch.mockClear();
        mockStripImages.mockClear();
        mockUnscopedCatalogReads = 0;
        mockTenantScopeViolations = 0;

        const first = await runPass(records, 1);
        const second = await runPass(records, 2);
        const reproducibleTrace = JSON.stringify(first.trace) === JSON.stringify(second.trace);
        const trace = first.trace;
        const generatedRows = mockLlmChat.mock.calls.map(([request]) => getPromptText(request));
        const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
        const presentationContractsValid = trace.filter(turn => turn.presentationContractValid).length;
        const modelGeneratedTurnCount = trace.filter(turn => turn.modelGenerated).length;
        const modelGateBlocks = trace.filter(turn => turn.modelGenerated && turn.outboundDecision !== grounding.GroundingDecision.SEND).length;
        const modelGateSends = trace.filter(turn => turn.modelGenerated && turn.outboundDecision === grounding.GroundingDecision.SEND).length;

        const artifact = {
            schemaVersion: 1,
            report: 'production route-code replay using synthetic tenant fixtures and a local fake provider',
            source: {
                basename: path.basename(DEFAULT_INPUT),
                sha256: sourceSha256,
                sizeBytes: source.length,
                sourceColumnsRecognized: headers.length,
                rawRowsOrCustomerTextPersisted: false,
                sourceLeftUnmodified: true,
            },
            dataset,
            fixtures: {
                tenantCount: new Set(mockCatalog.map(product => product.shop_id)).size,
                productCount: mockCatalog.length,
                tenantScopedCatalogReads: true,
                faqResults: 'empty synthetic adapter',
                imageAssets: 'fake fixture.invalid references; no source image files read',
                realVisionAccuracyEvaluated: false,
            },
            replay: {
                passes: 2,
                scenariosExecutedPerPass: trace.length,
                allScenariosExecuted: trace.length === 200,
                reproducibleTrace,
                evidenceAwareOracleTags: aggregate(trace, turn => turn.oracleTags.join('+')),
                routerSources: aggregate(trace, turn => turn.routerSource),
                productEvidenceOutcomes: aggregate(trace, turn => turn.productEvidence),
                presentationStatuses: aggregate(trace, turn => turn.presentationStatus),
                presentationContractsValid,
                outboundDecisions: aggregate(trace, turn => turn.outboundDecision),
                modelGeneratedTurns: modelGeneratedTurnCount,
                fakeModelInvocations: mockLlmChat.mock.calls.length,
                imageScenariosPerPass: first.imageScenarioCount,
                adversarialFakeModelGateBlocksPerPass: first.trace.filter(turn => turn.modelGenerated && turn.outboundDecision !== grounding.GroundingDecision.SEND).length,
                adversarialFakeModelGateSendsPerPass: first.trace.filter(turn => turn.modelGenerated && turn.outboundDecision === grounding.GroundingDecision.SEND).length,
                fakeVisionInvocations: 0,
                fakePhotoPathDisabled: true,
                piiPatternsInFakeProviderPromptsPerPass: first.piiPatternsInProviderPrompt,
                tenantScopeViolations: first.tenantScopeViolations,
                unscopedCatalogReads: mockUnscopedCatalogReads,
                readAuditAdapterAttemptsPerPass: first.readAuditAttempts,
                databaseConnections: 0,
                businessMutationCalls: 0,
                messengerSendCalls: 0,
                interpretation: 'Calls the production intent-router route and applies the production outbound grounding gate. Catalog, FAQ, cache, action audit and model collaborators are local mocks. The fake model returns an unsupported price and delivery promise to exercise the send gate. This is not a database, worker, Messenger, or real-provider integration test.',
            },
            performance: {
                harnessWallMs: Number((performance.now() - started).toFixed(2)),
                localRouteLatencyMs: {
                    p50: Number(percentile(first.routeDurationsMs, 0.50).toFixed(3)),
                    p95: Number(percentile(first.routeDurationsMs, 0.95).toFixed(3)),
                    mean: Number((first.routeDurationsMs.reduce((sum, value) => sum + value, 0) / Math.max(first.routeDurationsMs.length, 1)).toFixed(3)),
                    sampleCount: first.routeDurationsMs.length,
                },
                productionLatencyMeasured: false,
                providerTokenCount: 0,
                estimatedProviderCostUsd: 0,
                providerCostInterpretation: 'No remote provider calls were made; zero is local harness spend, not projected operating cost.',
            },
            turns: trace,
        };

        const artifactText = JSON.stringify(artifact, null, 2);
        expect(trace).toHaveLength(200);
        expect(second.trace).toHaveLength(200);
        expect(reproducibleTrace).toBe(true);
        expect(presentationContractsValid).toBe(200);
        expect(first.piiPatternsInProviderPrompt).toBe(0);
        expect(second.piiPatternsInProviderPrompt).toBe(0);
        expect(first.tenantScopeViolations).toBe(0);
        expect(second.tenantScopeViolations).toBe(0);
        expect(mockUnscopedCatalogReads).toBe(0);
        expect(modelGeneratedTurnCount).toBeGreaterThan(0);
        expect(modelGateBlocks).toBeGreaterThan(0);
        expect(modelGateSends).toBe(0);
        expect(generatedRows.some(prompt => PHONE_OR_EMAIL.test(prompt))).toBe(false);
        expect(artifactText).not.toContain('customerProfile');
        expect(artifactText).not.toContain('customerMessage');
        expect(artifactText).not.toContain('expectedTruth');
        expect(artifactText).not.toContain('simulatedAttachment');

        fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
        fs.writeFileSync(OUTPUT_PATH, `${artifactText}\n`, 'utf8');
    });
});
