'use strict';

const { loadGenuinePhotoFixture } = require('./genuine-photo-fixtures');
const { createGeminiProDiagnosticTransport, MODEL, sourceSha256 } = require('./gemini-pro-diagnostic-transport');

const makeParams = (overrides = {}) => ({
    systemPrompt: 'Use only visible image evidence.',
    messages: [{ role: 'user', content: [
        { type: 'image_url', url: loadGenuinePhotoFixture('yellow-kurta').dataUrl },
        { type: 'text', text: 'Identify the visible garment and color.' },
    ] }],
    maxTokens: 1024,
    signal: new AbortController().signal,
    preferredProvider: 'gemini-pro',
    skipProviders: ['gemini-lite', 'openai'],
    returnMetadata: true,
    thinkingLevel: 'low',
    evaluationEgressAuthorization: jest.fn(() => true),
    ...overrides,
});

describe('bounded Gemini Pro diagnostic transport', () => {
    const priorKey = process.env['EM-GEMINI-KEY'];
    const priorTemperature = process.env.LLM_TEMPERATURE;
    beforeEach(() => {
        process.env['EM-GEMINI-KEY'] = 'test-only-secret';
        process.env.LLM_TEMPERATURE = '0.3';
    });
    afterAll(() => {
        if (priorKey === undefined) delete process.env['EM-GEMINI-KEY'];
        else process.env['EM-GEMINI-KEY'] = priorKey;
        if (priorTemperature === undefined) delete process.env.LLM_TEMPERATURE;
        else process.env.LLM_TEMPERATURE = priorTemperature;
    });

    test('exposes the exact transport source hash for call receipts', () => {
        expect(sourceSha256()).toMatch(/^[a-f0-9]{64}$/i);
    });

    test('pins the model, low thinking setting, request permit, and allowlisted finish metadata', async () => {
        const fetchImpl = jest.fn(async (_url, _request) => ({
            ok: true,
            status: 200,
            headers: { get: name => name.toLowerCase() === 'x-goog-request-id' ? 'req-123' : null },
            json: async () => ({
                candidates: [{
                    content: { parts: [{ text: '{"category":"kurta","color":"yellow"}' }] },
                    finishReason: 'STOP',
                }],
                usageMetadata: { promptTokenCount: 1400, candidatesTokenCount: 40, thoughtsTokenCount: 80 },
            }),
        }));
        const params = makeParams();
        const transport = createGeminiProDiagnosticTransport({ fetchImpl });
        const response = await transport.chat(params);

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, request] = fetchImpl.mock.calls[0];
        expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`);
        const body = JSON.parse(request.body);
        expect(body.generationConfig).toEqual({
            maxOutputTokens: 1024,
            temperature: 0.3,
            thinkingConfig: { thinkingLevel: 'low' },
        });
        expect(body.contents[0].parts[0].inlineData.mimeType).toBe('image/jpeg');
        expect(params.evaluationEgressAuthorization).toHaveBeenCalledWith(expect.objectContaining({
            url, method: 'POST', redirect: 'error', body: request.body,
        }));
        expect(response).toMatchObject({
            text: '{"category":"kurta","color":"yellow"}',
            model: MODEL,
            provider: 'gemini-pro',
            requestId: 'req-123',
            finishReason: 'STOP',
            usage: { promptTokenCount: 1400, candidatesTokenCount: 40, thoughtsTokenCount: 80 },
        });
        expect(JSON.stringify(response)).not.toContain('test-only-secret');
    });

    test('rejects non-low thinking and does not make a provider request', async () => {
        const fetchImpl = jest.fn();
        const transport = createGeminiProDiagnosticTransport({ fetchImpl });
        await expect(transport.chat(makeParams({ thinkingLevel: 'high' })))
            .rejects.toThrow('Gemini Pro diagnostic transport rejected its configuration.');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
