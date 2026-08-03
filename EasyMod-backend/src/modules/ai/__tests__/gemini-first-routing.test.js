'use strict';

/**
 * Gemini-first provider routing, free-tier quota fallback, and vision policy.
 *
 * Covers the invariants the architecture validation locked in:
 *   A. Gemini is primary; OpenAI is only ever reached after Gemini fails.
 *   B. A free-tier 429 (quota exhausted) falls through to the next provider
 *      rather than surfacing as an error to the customer.
 *   C. No repository path makes OpenAI a primary/parallel/unconditional provider.
 *   D. Vision is off by default and no image bytes reach any provider.
 *   E. Gemini context caching is requested for the model that will serve the call.
 */

process.env.NODE_ENV = 'test';

jest.mock('src/config/redis', () => ({
    cacheRedis: {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        setex: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
        incr: jest.fn(async () => 1),
        expire: jest.fn(async () => 1),
        keys: jest.fn(async () => []),
    },
}));
jest.mock('src/utils/sse-manager', () => ({ broadcast: jest.fn(), sendToShop: jest.fn() }));
jest.mock('src/modules/ai/ops-alert.service', () => ({ alertLlmOutage: jest.fn(), notifyOps: jest.fn() }));

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../..');

describe('A — provider chain order', () => {
    let llm;
    beforeEach(() => {
        jest.resetModules();
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        llm = require('src/modules/ai/llm.service');
    });

    const geminiOk = (text) => ({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }),
    });
    const openaiOk = (text) => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: text } }], usage: {} }),
    });
    const fail = (status, body) => ({ ok: false, status, text: async () => body });

    test('the healthy path uses gemini-lite and never touches OpenAI', async () => {
        global.fetch = jest.fn(async () => geminiOk('gemini reply'));

        const res = await llm.chat({ systemPrompt: 'S', messages: [{ role: 'user', content: 'hi' }] });

        expect(res.provider).toBe('gemini-lite');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toContain(llm.GEMINI_LITE_MODEL);
        expect(global.fetch.mock.calls.some(([url]) => String(url).includes('openai.com'))).toBe(false);
    });

    test('a gemini-lite failure goes straight to OpenAI, skipping the 8x model', async () => {
        const urls = [];
        global.fetch = jest.fn(async (url) => {
            urls.push(String(url));
            if (String(url).includes('openai.com')) return openaiOk('openai reply');
            return fail(500, 'gemini down');
        });

        const res = await llm.chat({ systemPrompt: 'S', messages: [{ role: 'user', content: 'hi' }] });

        expect(res.provider).toBe('openai');
        expect(urls).toHaveLength(2);
        expect(urls[0]).toContain(llm.GEMINI_LITE_MODEL);
        expect(urls[1]).toContain('openai.com');
        expect(urls.some((u) => u.includes(llm.GEMINI_PRO_MODEL))).toBe(false);
    });

    test('LLM_AUTO_ESCALATE_TO_PRO=true restores the three-tier chain', async () => {
        jest.resetModules();
        process.env.LLM_AUTO_ESCALATE_TO_PRO = 'true';
        const withPro = require('src/modules/ai/llm.service');

        const urls = [];
        global.fetch = jest.fn(async (url) => {
            urls.push(String(url));
            if (String(url).includes('openai.com')) return openaiOk('openai reply');
            return fail(500, 'gemini down');
        });

        await withPro.chat({ messages: [{ role: 'user', content: 'hi' }] });
        delete process.env.LLM_AUTO_ESCALATE_TO_PRO;

        expect(urls).toHaveLength(3);
        expect(urls[1]).toContain(withPro.GEMINI_PRO_MODEL);
    });

    test('an explicit gemini-pro escalation is still honoured', async () => {
        const urls = [];
        global.fetch = jest.fn(async (url) => {
            urls.push(String(url));
            return geminiOk('pro reply');
        });

        const res = await llm.chat({
            messages: [{ role: 'user', content: 'hi' }], preferredProvider: 'gemini-pro',
        });

        expect(res.provider).toBe('gemini-pro');
        expect(urls[0]).toContain(llm.GEMINI_PRO_MODEL);
    });

    test('all providers failing throws rather than returning empty text', async () => {
        global.fetch = jest.fn(async () => fail(500, 'everything down'));
        await expect(llm.chat({ messages: [{ role: 'user', content: 'hi' }] }))
            .rejects.toThrow(/All LLM providers failed/);
    });
});

describe('B — free-tier quota exhaustion', () => {
    let llm;
    beforeEach(() => {
        jest.resetModules();
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        llm = require('src/modules/ai/llm.service');
    });

    // The production key is on a free Gemini project, so this is the failure the
    // system is most likely to meet at volume: RESOURCE_EXHAUSTED, not an outage.
    const QUOTA_429 = JSON.stringify({
        error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'You exceeded your current quota. Please check your plan and billing details.',
        },
    });

    test('a 429 on gemini-lite falls through to the OpenAI fallback', async () => {
        // The expensive Gemini tier is NOT the quota fallback: on a free project
        // it is limit=0, so quota exhaustion has to land on OpenAI to be answered.
        const urls = [];
        global.fetch = jest.fn(async (url) => {
            urls.push(String(url));
            if (String(url).includes('openai.com')) {
                return { ok: true, json: async () => ({ choices: [{ message: { content: 'openai reply' } }] }) };
            }
            return { ok: false, status: 429, text: async () => QUOTA_429 };
        });

        const res = await llm.chat({ messages: [{ role: 'user', content: 'hi' }] });

        expect(res.provider).toBe('openai');
        expect(res.text).toBe('openai reply');
        expect(urls).toHaveLength(2);
    });

    test('a project-wide 429 on Gemini still answers via OpenAI', async () => {
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes('openai.com')) {
                return { ok: true, json: async () => ({ choices: [{ message: { content: 'openai reply' } }] }) };
            }
            return { ok: false, status: 429, text: async () => QUOTA_429 };
        });

        const res = await llm.chat({ messages: [{ role: 'user', content: 'hi' }] });

        expect(res.provider).toBe('openai');
        expect(res.text).toBe('openai reply');
    });

    test('a quota 429 is recorded as a provider failure, so the breaker can trip', async () => {
        const { cacheRedis } = require('src/config/redis');
        global.fetch = jest.fn(async () => ({ ok: false, status: 429, text: async () => QUOTA_429 }));

        await expect(llm.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();

        // One INCR per provider attempt — the breaker sees quota errors, so a
        // sustained free-tier outage opens the circuit instead of retrying forever.
        expect(cacheRedis.incr).toHaveBeenCalled();
    });
});

describe('C — no OpenAI-primary paths in the repository', () => {
    const walk = (dir, out = []) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
                walk(full, out);
            } else if (entry.name.endsWith('.js')) out.push(full);
        }
        return out;
    };

    // Comments legitimately mention the override while explaining why it is gone.
    const stripComments = (src) => src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    test('nothing forces preferredProvider to openai', () => {
        const offenders = walk(SRC)
            .filter((f) => /preferredProvider:\s*['"]openai['"]/.test(stripComments(fs.readFileSync(f, 'utf8'))))
            .map((f) => path.relative(SRC, f).replace(/\\/g, '/'));

        // Gemini is multimodal and primary for every operation. The one historical
        // exception was product-ai.service.js pinning OpenAI for vision.
        expect(offenders).toEqual([]);
    });

    test('gemini-lite is the first entry in the provider chain', () => {
        const src = fs.readFileSync(path.join(SRC, 'modules/ai/llm.service.js'), 'utf8');
        const chain = src.match(/const PROVIDERS = \[([\s\S]*?)\];/)[1];
        const order = [...chain.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
        expect(order).toEqual(['gemini-lite', 'gemini-pro', 'openai']);
    });
});

describe('D — vision policy', () => {
    beforeEach(() => { jest.resetModules(); delete process.env.AI_VISION_ENABLED; });

    test('vision is disabled by default', () => {
        const { visionEnabled } = require('src/modules/ai/vision-policy.service');
        expect(visionEnabled()).toBe(false);
    });

    test('image blocks are stripped from outgoing messages, text is kept', () => {
        const { stripImageBlocks } = require('src/modules/ai/vision-policy.service');
        const out = stripImageBlocks([{
            role: 'user',
            content: [
                { type: 'image_url', url: 'https://example.test/a.jpg' },
                { type: 'text', text: 'ei ta ache?' },
            ],
        }]);

        expect(out[0].content).toBe('ei ta ache?');
        expect(JSON.stringify(out)).not.toContain('image_url');
        expect(JSON.stringify(out)).not.toContain('a.jpg');
    });

    test('a caption-less photo becomes a text placeholder, not an image', () => {
        const { stripImageBlocks } = require('src/modules/ai/vision-policy.service');
        const out = stripImageBlocks([{ role: 'user', content: [{ type: 'image_url', url: 'x.jpg' }] }]);
        expect(out[0].content).toBe('[the customer sent a photo]');
    });

    test('blocks pass through untouched when vision is explicitly enabled', () => {
        process.env.AI_VISION_ENABLED = 'true';
        const { stripImageBlocks, visionEnabled } = require('src/modules/ai/vision-policy.service');
        const input = [{ role: 'user', content: [{ type: 'image_url', url: 'x.jpg' }] }];
        expect(visionEnabled()).toBe(true);
        expect(stripImageBlocks(input)).toBe(input);
    });

    test('no image bytes reach a provider on the default customer-image path', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        const llm = require('src/modules/ai/llm.service');
        const { stripImageBlocks } = require('src/modules/ai/vision-policy.service');

        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        }));

        await llm.chat({
            messages: stripImageBlocks([{
                role: 'user',
                content: [{ type: 'image_url', url: 'https://example.test/photo.jpg' }, { type: 'text', text: 'dam koto' }],
            }]),
        });

        const body = global.fetch.mock.calls[0][1].body;
        expect(body).not.toContain('inlineData');
        expect(body).toContain('dam koto');
    });
});

describe('E — Gemini context cache targets the serving model', () => {
    test('getOrCreate caches for the model that will actually serve the request', async () => {
        jest.resetModules();
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        const cache = require('src/modules/ai/gemini-cache.service');
        const llm = require('src/modules/ai/llm.service');

        const seen = [];
        global.fetch = jest.fn(async (url, init) => {
            seen.push(JSON.parse(init.body).model);
            return { ok: true, json: async () => ({ name: 'cachedContents/abc' }) };
        });

        await cache.getOrCreate('shop-1', 'x'.repeat(1200));

        // A cache created against a different model is silently unusable by the
        // generateContent call, which is how caching can look wired up and never hit.
        expect(seen[0]).toBe(`models/${llm.GEMINI_LITE_MODEL}`);
    });
});
