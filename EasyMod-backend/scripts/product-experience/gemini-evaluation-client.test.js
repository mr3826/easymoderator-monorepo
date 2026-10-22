'use strict';

const { createEvaluationBudget, GEMINI_PRO_PRICE_SNAPSHOT } = require('./evaluation-budget');
const { createGeminiEvaluationClient, EvaluationClientError, MODEL } = require('./gemini-evaluation-client');
const { loadGenuinePhotoFixture, GENUINE_PHOTO_MANIFEST } = require('./genuine-photo-fixtures');
const { loadSyntheticMediaFixture, SYNTHETIC_MEDIA_MANIFEST } = require('./synthetic-media-fixtures');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const makeBudget = overrides => createEvaluationBudget({ ceilingUsd: 0.1, ...overrides });
const validParams = overrides => ({
    systemPrompt: 'Use only provided evidence.',
    messages: [{ role: 'user', content: 'Describe the supplied product.' }],
    ...overrides,
});

describe('bounded Gemini evaluation client', () => {
    const originalKey = process.env['EM-GEMINI-KEY'];
    const originalLegacyKey = process.env.GEMINI_API_KEY;

    afterEach(() => {
        if (originalKey === undefined) delete process.env['EM-GEMINI-KEY'];
        else process.env['EM-GEMINI-KEY'] = originalKey;
        if (originalLegacyKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalLegacyKey;
    });

    test('requires the exact non-empty EM-GEMINI-KEY before reserving or calling a provider', async () => {
        delete process.env['EM-GEMINI-KEY'];
        process.env.GEMINI_API_KEY = 'legacy-only-secret';
        const budget = makeBudget();
        const llm = { chat: jest.fn() };
        const client = createGeminiEvaluationClient({ budget, llm });

        await expect(client.chat(validParams())).rejects.toMatchObject({ code: 'EM_GEMINI_KEY_UNAVAILABLE' });
        expect(llm.chat).not.toHaveBeenCalled();
        expect(budget.snapshot().requestCount).toBe(0);
        process.env['EM-GEMINI-KEY'] = '   ';
        await expect(client.chat(validParams())).rejects.toMatchObject({ code: 'EM_GEMINI_KEY_UNAVAILABLE' });
    });

    test('reserves before transport and pins the provider/model with fallback and cache disabled', async () => {
        process.env['EM-GEMINI-KEY'] = 'test-only-secret';
        const budget = makeBudget();
        const llm = { chat: jest.fn(async params => {
            expect(budget.snapshot().requestCount).toBe(1);
            expect(params).toEqual(expect.objectContaining({
                preferredProvider: 'gemini-lite',
                skipProviders: ['gemini-pro', 'openai'],
                cachedContentName: undefined,
                returnMetadata: true,
                maxTokens: 128,
                timeoutMs: 30000,
                signal: expect.any(AbortSignal),
            }));
            return {
                text: 'Synthetic image description.',
                provider: 'gemini-lite',
                model: MODEL,
                requestId: 'req-123',
                latencyMs: 57,
                usage: { promptTokenCount: 45, candidatesTokenCount: 7, thoughtsTokenCount: 2 },
            };
        }) };
        const client = createGeminiEvaluationClient({ budget, llm });
        const result = await client.chat(validParams({ maxTokens: 128, operationId: 'fixture-01' }));

        expect(llm.chat).toHaveBeenCalledTimes(1);
        expect(llm.chat.mock.calls[0][0].systemPrompt).toBe('Use only provided evidence.');
        expect(result).toMatchObject({
            text: 'Synthetic image description.',
            provider: 'gemini-lite',
            model: MODEL,
            requestId: 'req-123',
            latencyMs: 57,
            usage: { promptTokenCount: 45, candidatesTokenCount: 7 },
            budget: { status: 'provider_reported', requestId: 'req-123', latencyMs: 57 },
        });
        const receiptText = JSON.stringify({ result: result.budget, snapshot: budget.snapshot() });
        expect(receiptText).not.toContain('test-only-secret');
        expect(receiptText).not.toContain('Synthetic image description.');
        expect(receiptText).not.toContain('Use only provided evidence.');
        expect(receiptText).not.toContain('fixture-01');
    });

    test('routes an explicitly configured bounded image probe through Gemini Pro only', async () => {
        process.env['EM-GEMINI-KEY'] = 'test-only-secret';
        const model = GEMINI_PRO_PRICE_SNAPSHOT.model;
        const budget = makeBudget({ model, thinkingLevel: 'low' });
        const llm = { chat: jest.fn(async params => {
            expect(params).toEqual(expect.objectContaining({
                preferredProvider: 'gemini-pro',
                skipProviders: ['gemini-lite', 'openai'],
                returnMetadata: true,
                thinkingLevel: 'low',
            }));
            return { text: 'Visible garment observation.', provider: 'gemini-pro', model,
                usage: { promptTokenCount: 4200, candidatesTokenCount: 10 }, finishReason: 'STOP' };
        }) };
        const client = createGeminiEvaluationClient({ budget, llm, model });
        const fixture = loadGenuinePhotoFixture('yellow-kurta');
        const result = await client.chat(validParams({ messages: [{ role: 'user', content: [
            { type: 'text', text: 'Identify visible garment and color.' },
            { type: 'image_url', url: fixture.dataUrl },
        ] }] }));

        expect(result).toMatchObject({ provider: 'gemini-pro', model, finishReason: 'STOP' });
        expect(budget.snapshot()).toMatchObject({ model, visionRequestCount: 1, pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 12 } });
        expect(JSON.stringify(budget.snapshot())).not.toContain(fixture.dataUrl);
    });

    test('rejects model names inherited from JavaScript object prototypes', () => {
        const budget = { execute: jest.fn(), snapshot: () => ({ model: 'toString' }) };
        expect(() => createGeminiEvaluationClient({ budget, llm: { chat: jest.fn() }, model: 'toString' }))
            .toThrow(EvaluationClientError);
    });

    test('accepts one bounded local raster image and counts the request as vision', async () => {
        process.env['EM-GEMINI-KEY'] = 'test-only-secret';
        const fixture = loadSyntheticMediaFixture('denim-jacket-blue');
        const budget = makeBudget({ maxVisionRequests: 1 });
        const llm = { chat: jest.fn(async () => ({
            text: 'Synthetic image description.', provider: 'gemini-lite', model: MODEL,
            usage: { promptTokenCount: 4100, candidatesTokenCount: 9 },
        })) };
        const client = createGeminiEvaluationClient({ budget, llm });
        await client.chat(validParams({ messages: [{ role: 'user', content: [
            { type: 'text', text: 'Describe this image.' },
            { type: 'image_url', url: fixture.dataUrl },
        ] }] }));
        expect(llm.chat).toHaveBeenCalledTimes(1);
        expect(budget.snapshot()).toMatchObject({ visionRequestCount: 1, calls: [{ vision: true, inputTokenUpperBound: expect.any(Number) }] });
        expect(budget.snapshot().calls[0].inputTokenUpperBound).toBeGreaterThanOrEqual(16384);
        expect(llm.chat.mock.calls[0][0].messages[0].content[1].url).toBe(fixture.dataUrl);
        expect(JSON.stringify(budget.snapshot())).not.toContain(fixture.dataUrl);
    });

    test('loads exactly the four checksum-verified direct-generation fixtures', () => {
        expect(SYNTHETIC_MEDIA_MANIFEST.assets).toHaveLength(4);
        for (const asset of SYNTHETIC_MEDIA_MANIFEST.assets) {
            const fixture = loadSyntheticMediaFixture(asset.id);
            expect(fixture).toMatchObject({ assetId: asset.id, bytes: asset.bytes, sha256: asset.sha256, mimeType: 'image/png' });
            expect(fixture.dataUrl).toMatch(/^data:image\/png;base64,/);
        }
        expect(() => loadSyntheticMediaFixture('../synthetic-contact-sheet-source')).toThrow(/not registered/);
    });

    test('loads the provenance-checked genuine photo set without relying on source-dataset images', () => {
        expect(GENUINE_PHOTO_MANIFEST.assets).toHaveLength(3);
        expect(GENUINE_PHOTO_MANIFEST.sourceDatasetPhotosProvided).toBe(false);
        for (const asset of GENUINE_PHOTO_MANIFEST.assets) {
            const fixture = loadGenuinePhotoFixture(asset.id);
            expect(fixture).toMatchObject({
                assetId: asset.id,
                bytes: asset.bytes,
                sha256: asset.sha256,
                mimeType: 'image/jpeg',
                sourcePageUrl: asset.sourcePageUrl,
                author: asset.author,
                license: asset.license,
            });
            expect(fixture.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
            expect(fixture.expectedVisible.category).toEqual(expect.arrayContaining(['kurta']));
            expect(fixture.expectedVisible.dominantColor.length).toBeGreaterThan(0);
        }
        expect(() => loadGenuinePhotoFixture('../yellow-kurta.jpg')).toThrow(/not registered/);
    });

    test('accepts only a checksum-registered genuine photo and meters it as vision', async () => {
        process.env['EM-GEMINI-KEY'] = 'test-only-secret';
        const fixture = loadGenuinePhotoFixture('yellow-kurta');
        const budget = makeBudget({ maxVisionRequests: 1 });
        const llm = { chat: jest.fn(async () => ({
            text: 'The image visibly shows a yellow kurta.', provider: 'gemini-lite', model: MODEL,
            usage: { promptTokenCount: 4200, candidatesTokenCount: 10 },
        })) };
        const client = createGeminiEvaluationClient({ budget, llm });
        await client.chat(validParams({ messages: [{ role: 'user', content: [
            { type: 'text', text: 'Identify visible garment and color.' },
            { type: 'image_url', url: fixture.dataUrl },
        ] }] }));
        expect(llm.chat).toHaveBeenCalledTimes(1);
        expect(budget.snapshot()).toMatchObject({ visionRequestCount: 1, calls: [{ vision: true }] });
        expect(JSON.stringify(budget.snapshot())).not.toContain(fixture.dataUrl);
    });

    test.each([
        ['remote URL', 'https://example.test/photo.png'],
        ['SVG data URL', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
        ['mismatched raster', 'data:image/png;base64,PHN2Zz48L3N2Zz4='],
        ['unregistered raster', PNG],
    ])('rejects %s before reserving a paid request', async (_label, url) => {
        process.env['EM-GEMINI-KEY'] = 'test-only-secret';
        const budget = makeBudget();
        const llm = { chat: jest.fn() };
        const client = createGeminiEvaluationClient({ budget, llm });
        await expect(client.chat(validParams({ messages: [{ role: 'user', content: [{ type: 'image_url', url }] }] })))
            .rejects.toBeInstanceOf(EvaluationClientError);
        expect(llm.chat).not.toHaveBeenCalled();
        expect(budget.snapshot().requestCount).toBe(0);
    });

    test('rejects fallback, unexpected model, and provider failures without exposing content', async () => {
        process.env['EM-GEMINI-KEY'] = 'test-only-secret';
        const llm = { chat: jest.fn()
            .mockResolvedValueOnce({ text: 'would be a costly fallback', provider: 'openai', model: 'openai-model' })
            .mockRejectedValueOnce(new Error('provider response includes customer@example.test and secret')) };
        const budget = makeBudget({ maxRetries: 1 });
        const client = createGeminiEvaluationClient({ budget, llm });

        await expect(client.chat(validParams({ operationId: 'unexpected-provider' })))
            .rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
        await expect(client.chat(validParams({ operationId: 'provider-error' })))
            .rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
        expect(JSON.stringify(budget.snapshot())).not.toMatch(/customer@example|secret|would be a costly/);
        expect(budget.snapshot().calls).toMatchObject([
            { status: 'transport_failed', providerReportedUsd: null },
            { status: 'transport_failed', providerReportedUsd: null },
        ]);
    });

    test('rejects injected and unaccounted message fields', async () => {
        process.env['EM-GEMINI-KEY'] = 'test-only-secret';
        const budget = makeBudget();
        const llm = { chat: jest.fn() };
        const client = createGeminiEvaluationClient({ budget, llm });
        await expect(client.chat(validParams({ messages: [{ role: 'user', content: 'hello', toolCall: 'unmetered' }] })))
            .rejects.toMatchObject({ code: 'UNSUPPORTED_MESSAGE_FIELDS' });
        await expect(client.chat(validParams({ messages: [{ role: 'assistant', content: [{ type: 'image_url', url: PNG }] }] })))
            .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_FIELDS' });
        expect(llm.chat).not.toHaveBeenCalled();
        expect(budget.snapshot().requestCount).toBe(0);
    });
});
