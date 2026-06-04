'use strict';

/**
 * Embedding provider self-check — getProviderInfo() / probe().
 * Guards the #1 hallucination cause: silently running on the non-semantic
 * local fallback (or a typo'd provider that falls through to it).
 */

const svc = require('../embedding.service');

const ENV_KEYS = ['EMBEDDING_PROVIDER', 'EMBEDDING_API_URL', 'OPENAI_API_KEY'];
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
});
