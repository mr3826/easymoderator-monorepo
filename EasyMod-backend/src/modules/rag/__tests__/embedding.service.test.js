'use strict';

/**
 * Embedding provider self-check — getProviderInfo() / probe().
 * Guards the #1 hallucination cause: silently running on the non-semantic
 * local fallback (or a typo'd provider that falls through to it).
 */

const svc = require('../embedding.service');

const ENV_KEYS = [
    'EMBEDDING_PROVIDER', 'EMBEDDING_API_URL', 'OPENAI_API_KEY',
    'EMBEDDING_MODEL', 'GEMINI_API_KEY', 'GEMINI_EMBEDDING_MODEL',
    'NODE_ENV',
];
const saved = {};
beforeEach(() => { ENV_KEYS.forEach(k => { saved[k] = process.env[k]; }); });
afterEach(() => {
    ENV_KEYS.forEach(k => {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    });
});

describe('getProviderInfo', () => {
    test('unset → non-semantic local fallback', () => {
        delete process.env.EMBEDDING_PROVIDER;
        const info = svc.getProviderInfo();
        expect(info.effective).toBe('local');
        expect(info.semantic).toBe(false);
    });

    test('production defaults to Gemini as the primary provider', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.EMBEDDING_PROVIDER;
        const info = svc.getProviderInfo();
        expect(info).toMatchObject({
            configured: 'gemini',
            effective: 'gemini',
            semantic: true,
            model: 'gemini-embedding-2',
            fallbackProvider: 'openai',
            fallbackModel: 'text-embedding-3-small',
        });
    });

    test("'http' is a valid alias for the HTTP embedding client (semantic)", () => {
        process.env.EMBEDDING_PROVIDER = 'http';
        process.env.EMBEDDING_API_URL = 'http://tei:8080/embed';
        const info = svc.getProviderInfo();
        expect(info.effective).toBe('gcp');
        expect(info.semantic).toBe(true);
        expect(info.keyPresent).toBe(true); // EMBEDDING_API_URL present
    });

    test("'tei' alias also maps to the HTTP client", () => {
        process.env.EMBEDDING_PROVIDER = 'tei';
        expect(svc.getProviderInfo().effective).toBe('gcp');
    });

    test('openai reports OPENAI_API_KEY presence', () => {
        process.env.EMBEDDING_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = '';
        expect(svc.getProviderInfo()).toMatchObject({ effective: 'openai', semantic: true, keyPresent: false });
        process.env.OPENAI_API_KEY = 'sk-test';
        expect(svc.getProviderInfo().keyPresent).toBe(true);
    });

    test('gemini is semantic and reports GEMINI_API_KEY presence', () => {
        process.env.EMBEDDING_PROVIDER = 'gemini';
        delete process.env.GEMINI_API_KEY;
        expect(svc.getProviderInfo()).toMatchObject({
            effective: 'gemini', semantic: true, keyPresent: false, model: 'gemini-embedding-2',
        });
        process.env.GEMINI_API_KEY = 'AIza-test';
        expect(svc.getProviderInfo().keyPresent).toBe(true);
    });

    test("'google' alias maps to gemini", () => {
        process.env.EMBEDDING_PROVIDER = 'google';
        expect(svc.getProviderInfo().effective).toBe('gemini');
    });

    test('anthropic / unknown values fall back to non-semantic local', () => {
        process.env.EMBEDDING_PROVIDER = 'anthropic';
        expect(svc.getProviderInfo().semantic).toBe(false);
        process.env.EMBEDDING_PROVIDER = 'banana';
        expect(svc.getProviderInfo().effective).toBe('local');
    });
});

describe('probe', () => {
    test('local provider still returns a vector of the configured size', async () => {
        delete process.env.EMBEDDING_PROVIDER;
        const info = svc.getProviderInfo();
        const result = await svc.probe();
        expect(result.ok).toBe(true);
        expect(result.semantic).toBe(false);
        expect(result.dimensions).toBe(info.vectorSize);
    });

    test('openai with no API key fails the probe (never throws)', async () => {
        process.env.EMBEDDING_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = '';
        const result = await svc.probe();
        expect(result.ok).toBe(false);
        expect(result.provider).toBe('openai');
        expect(result.error).toBeTruthy();
    });

    test('gemini asks for exactly QDRANT_VECTOR_SIZE dimensions', async () => {
        process.env.EMBEDDING_PROVIDER = 'gemini';
        process.env.GEMINI_API_KEY = 'AIza-test';
        const { vectorSize } = svc.getProviderInfo();

        const realFetch = global.fetch;
        global.fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ embedding: { values: new Array(vectorSize).fill(0.1) } }),
        }));
        try {
            const result = await svc.probe();
            expect(result).toMatchObject({ ok: true, provider: 'gemini', semantic: true, dimensions: vectorSize });

            const [url, init] = global.fetch.mock.calls[0];
            expect(url).toContain('models/gemini-embedding-2:embedContent');
            expect(JSON.parse(init.body).outputDimensionality).toBe(vectorSize);
        } finally {
            global.fetch = realFetch;
        }
    });

    test('Gemini failure uses the OpenAI fallback with the configured vector size', async () => {
        process.env.NODE_ENV = 'production';
        process.env.EMBEDDING_PROVIDER = 'gemini';
        process.env.GEMINI_API_KEY = 'AIza-test-primary';
        process.env.OPENAI_API_KEY = 'sk-test-fallback';
        process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
        const { vectorSize } = svc.getProviderInfo();
        const calls = [];
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const realFetch = global.fetch;
        global.fetch = jest.fn(async (url) => {
            calls.push(String(url).includes('generativelanguage') ? 'gemini' : 'openai');
            if (String(url).includes('generativelanguage')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ embedding: { values: [0.1] } }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ data: [{ embedding: new Array(vectorSize).fill(0.2) }] }),
            };
        });
        try {
            const vector = await svc.getEmbedding('fallback test');
            expect(vector).toHaveLength(vectorSize);
            expect(calls).toEqual(['gemini', 'openai']);
            expect(warning).toHaveBeenCalledWith(expect.stringContaining('gemini -> openai'));
            expect(warning.mock.calls[0][0]).not.toContain('AIza-test-primary');
            expect(warning.mock.calls[0][0]).not.toContain('sk-test-fallback');
        } finally {
            global.fetch = realFetch;
            warning.mockRestore();
        }
    });

    test('failed OpenAI fallback surfaces a sanitized terminal error', async () => {
        process.env.NODE_ENV = 'production';
        process.env.EMBEDDING_PROVIDER = 'gemini';
        process.env.GEMINI_API_KEY = 'AIza-test-primary';
        process.env.OPENAI_API_KEY = 'sk-test-fallback';
        const realFetch = global.fetch;
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes('generativelanguage')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ embedding: { values: [0.1] } }),
                };
            }
            return {
                ok: false,
                status: 401,
                text: async () => `invalid key ${process.env.OPENAI_API_KEY}`,
            };
        });
        try {
            let error;
            try {
                await svc.getEmbedding('terminal failure test');
            } catch (caught) {
                error = caught;
            }
            expect(error).toMatchObject({ name: 'EmbeddingFallbackError' });
            expect(error.message).toContain('OpenAI fallback failed');
            expect(error.message).not.toContain('AIza-test-primary');
            expect(error.message).not.toContain('sk-test-fallback');
        } finally {
            global.fetch = realFetch;
            warning.mockRestore();
        }
    });
});
