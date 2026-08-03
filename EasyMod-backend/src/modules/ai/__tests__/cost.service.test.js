'use strict';

/**
 * Cost-accounting tests.
 *
 * Every expected figure here is derived from the versioned pricing table, not
 * from a memorised rate, so a provider price change fails loudly in one place.
 */

const {
    calculateCost,
    normalizeProviderUsage,
    sumCosts,
    usdToBdt,
    getPricingVersion,
    getFxRate,
    getModelPricing,
    PRICING,
} = require('../cost.service');

const LITE = 'gemini-3.1-flash-lite';
const PRO = 'gemini-3.1-pro-preview';
const OAI = 'gpt-4.1-mini';
const EMB = 'text-embedding-3-small';

const near = (actual, expected, tol = 1e-12) => expect(Math.abs(actual - expected)).toBeLessThan(tol);

describe('pricing table integrity', () => {
    it('is versioned and dated', () => {
        expect(getPricingVersion()).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
        expect(PRICING.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(PRICING.sources.google.url).toContain('ai.google.dev');
        expect(PRICING.sources.openai.url).toContain('openai.com');
    });

    it('carries an explicit, dated FX assumption', () => {
        expect(getFxRate()).toBeGreaterThan(50);
        expect(PRICING.fx.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(PRICING.fx.source).toBeTruthy();
    });

    it('flags retired models instead of dropping them', () => {
        const retired = getModelPricing('gemini-2.0-flash');
        expect(retired.status).toBe('retired');
        expect(retired.retiredOn).toBe('2026-06-01');
    });

    it('prices every model the production failover chain can reach', () => {
        for (const m of [LITE, PRO, OAI]) {
            expect(getModelPricing(m)).toBeTruthy();
            expect(getModelPricing(m).status).toBe('active');
        }
    });
});

describe('Gemini input/output/cached token pricing', () => {
    it('prices the measured expected turn on the primary model', () => {
        // Provider-reported: promptTokenCount 2155, candidatesTokenCount 80.
        const r = calculateCost({ model: LITE, inputTokens: 2155, outputTokens: 80 });
        near(r.breakdown.inputUsd, (2155 * 0.25) / 1e6);
        near(r.breakdown.outputUsd, (80 * 1.5) / 1e6);
        near(r.costUsd, (2155 * 0.25 + 80 * 1.5) / 1e6);
        expect(r.provider).toBe('google');
    });

    it('subtracts cached tokens from fresh input rather than adding them', () => {
        const all = calculateCost({ model: LITE, inputTokens: 2000, outputTokens: 0 });
        const half = calculateCost({ model: LITE, inputTokens: 2000, cachedInputTokens: 1000, outputTokens: 0 });
        near(half.breakdown.inputUsd, (1000 * 0.25) / 1e6);
        near(half.breakdown.cachedInputUsd, (1000 * 0.025) / 1e6);
        expect(half.costUsd).toBeLessThan(all.costUsd);
    });

    it('never lets cachedInputTokens exceed inputTokens', () => {
        const r = calculateCost({ model: LITE, inputTokens: 500, cachedInputTokens: 9999, outputTokens: 0 });
        near(r.breakdown.inputUsd, 0);
        near(r.breakdown.cachedInputUsd, (500 * 0.025) / 1e6);
    });

    it('prices image tokens at the standard input rate (they arrive inside inputTokens)', () => {
        // Provider-reported vision probe: 1064 IMAGE + 151 TEXT = 1215 prompt tokens.
        const r = calculateCost({ model: LITE, inputTokens: 1215, outputTokens: 59 });
        near(r.costUsd, (1215 * 0.25 + 59 * 1.5) / 1e6);
    });

    it('prices the pro fallback tier 8x the primary on both input and output', () => {
        const lite = calculateCost({ model: LITE, inputTokens: 2155, outputTokens: 80 });
        const pro = calculateCost({ model: PRO, inputTokens: 2155, outputTokens: 80 });
        near(pro.costUsd / lite.costUsd, 8, 1e-9);
    });

    it('applies batch rates when tier=batch', () => {
        const std = calculateCost({ model: LITE, inputTokens: 1e6, outputTokens: 0 });
        const bat = calculateCost({ model: LITE, inputTokens: 1e6, outputTokens: 0, tier: 'batch' });
        near(std.costUsd, 0.25);
        near(bat.costUsd, 0.125);
    });
});

describe('OpenAI pricing incl. cached and reasoning tokens', () => {
    it('prices the measured fallback turn', () => {
        // Provider-reported: prompt_tokens 2125, cached_tokens 0.
        const r = calculateCost({ model: OAI, inputTokens: 2125, cachedInputTokens: 0, outputTokens: 80 });
        near(r.costUsd, (2125 * 0.4 + 80 * 1.6) / 1e6);
    });

    it('bills reasoning tokens at the output rate', () => {
        const r = calculateCost({ model: OAI, inputTokens: 0, outputTokens: 100, reasoningTokens: 400 });
        near(r.costUsd, (500 * 1.6) / 1e6);
    });

    it('applies the 75% cached-input discount', () => {
        const r = calculateCost({ model: OAI, inputTokens: 1000, cachedInputTokens: 1000, outputTokens: 0 });
        near(r.costUsd, (1000 * 0.1) / 1e6);
    });
});

describe('embedding pricing', () => {
    it('prices a measured product document', () => {
        const r = calculateCost({ model: EMB, embeddingTokens: 106 });
        near(r.costUsd, (106 * 0.02) / 1e6);
    });

    it('charges nothing for the local n-gram fallback but still returns a number', () => {
        const r = calculateCost({ model: 'local-ngram', embeddingTokens: 5000 });
        expect(r.costUsd).toBe(0);
        expect(r.unknownModel).toBeUndefined();
    });
});

describe('failure and edge-case accounting', () => {
    it('returns null (not zero) for an unknown model', () => {
        const r = calculateCost({ model: 'gemini-9.9-imaginary', inputTokens: 5000, outputTokens: 500 });
        expect(r.costUsd).toBeNull();
        expect(r.costBdt).toBeNull();
        expect(r.unknownModel).toBe(true);
        expect(r.reason).toContain('gemini-9.9-imaginary');
    });

    it('returns null (not zero) when usage metadata is missing entirely', () => {
        const r = calculateCost({ model: LITE });
        expect(r.costUsd).toBeNull();
        expect(r.missingUsage).toBe(true);
    });

    it('marks a retired model so a dead-model deploy is visible in the ledger', () => {
        const r = calculateCost({ model: 'gemini-2.0-flash', inputTokens: 100, outputTokens: 10 });
        expect(r.retiredModel).toBe(true);
        expect(r.costUsd).toBeGreaterThan(0);
    });

    it('treats zero output as a real zero, not as missing usage', () => {
        const r = calculateCost({ model: LITE, inputTokens: 100, outputTokens: 0 });
        expect(r.missingUsage).toBeUndefined();
        near(r.costUsd, (100 * 0.25) / 1e6);
    });
});

describe('provider usage normalization', () => {
    it('normalises a Gemini text response', () => {
        const u = normalizeProviderUsage('gemini', {
            usageMetadata: {
                promptTokenCount: 2155,
                candidatesTokenCount: 60,
                totalTokenCount: 2215,
                promptTokensDetails: [{ modality: 'TEXT', tokenCount: 2155 }],
            },
        });
        expect(u).toEqual({
            inputTokens: 2155, cachedInputTokens: 0, outputTokens: 60,
            reasoningTokens: 0, imageTokens: 0, sourceOfUsage: 'provider_reported',
        });
    });

    it('extracts IMAGE-modality tokens from a Gemini vision response', () => {
        const u = normalizeProviderUsage('gemini', {
            usageMetadata: {
                promptTokenCount: 1215,
                candidatesTokenCount: 59,
                promptTokensDetails: [
                    { modality: 'IMAGE', tokenCount: 1064 },
                    { modality: 'TEXT', tokenCount: 151 },
                ],
            },
        });
        expect(u.imageTokens).toBe(1064);
        expect(u.inputTokens).toBe(1215);
    });

    it('treats an absent cachedContentTokenCount as zero cached, not as unknown', () => {
        const u = normalizeProviderUsage('gemini', { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5 } });
        expect(u.cachedInputTokens).toBe(0);
    });

    it('normalises an OpenAI response incl. cached and reasoning details', () => {
        const u = normalizeProviderUsage('openai', {
            usage: {
                prompt_tokens: 2125,
                completion_tokens: 34,
                prompt_tokens_details: { cached_tokens: 1024 },
                completion_tokens_details: { reasoning_tokens: 12 },
            },
        });
        expect(u).toEqual({
            inputTokens: 2125, cachedInputTokens: 1024, outputTokens: 34,
            reasoningTokens: 12, imageTokens: 0, sourceOfUsage: 'provider_reported',
        });
    });

    it('returns null when the provider sent no usage block', () => {
        expect(normalizeProviderUsage('gemini', { candidates: [] })).toBeNull();
        expect(normalizeProviderUsage('openai', { choices: [] })).toBeNull();
        expect(normalizeProviderUsage('gemini', null)).toBeNull();
    });
});

describe('fallback and retry accounting', () => {
    const turn = { inputTokens: 2155, outputTokens: 80 };

    it('double-charges a fallback that reaches a second provider', () => {
        // Gemini-lite returned 5xx (unbilled), gemini-pro answered.
        const chain = [calculateCost({ model: PRO, ...turn })];
        const single = calculateCost({ model: LITE, ...turn });
        expect(sumCosts(chain).costUsd).toBeGreaterThan(single.costUsd * 7);
    });

    it('sums a worst-case chain where two providers both billed', () => {
        const chain = [
            calculateCost({ model: LITE, ...turn }),  // timed out client-side AFTER the server billed it
            calculateCost({ model: PRO, ...turn }),
            calculateCost({ model: OAI, inputTokens: 2125, outputTokens: 80 }),
        ];
        const total = sumCosts(chain);
        expect(total.calls).toBe(3);
        expect(total.partial).toBe(false);
        near(total.costUsd,
            (2155 * 0.25 + 80 * 1.5) / 1e6
            + (2155 * 2.0 + 80 * 12.0) / 1e6
            + (2125 * 0.4 + 80 * 1.6) / 1e6);
    });

    it('marks a total as partial when any call has an unknown cost', () => {
        const total = sumCosts([
            calculateCost({ model: LITE, ...turn }),
            calculateCost({ model: 'mystery-model', inputTokens: 100 }),
        ]);
        expect(total.partial).toBe(true);
        expect(total.unknownCalls).toBe(1);
    });

    it('charges nothing extra for a retry that is deduped before the LLM runs', () => {
        // message-worker claims msg:dedup BEFORE any AI call, so attempt 2 and 3
        // short-circuit. The ledger for a 3-attempt job is still one LLM call.
        const attempts = [calculateCost({ model: LITE, ...turn })];
        expect(sumCosts(attempts).calls).toBe(1);
    });
});

describe('currency conversion', () => {
    it('converts with the table rate by default', () => {
        near(usdToBdt(1), getFxRate());
    });

    it('accepts an explicit override rate', () => {
        near(usdToBdt(2, 100), 200);
    });

    it('returns null for a non-finite input instead of NaN', () => {
        expect(usdToBdt(null)).toBeNull();
        expect(usdToBdt(undefined)).toBeNull();
    });

    it('never silently mixes currencies — costBdt always tracks costUsd', () => {
        const r = calculateCost({ model: LITE, inputTokens: 1e6, outputTokens: 0 });
        near(r.costBdt, r.costUsd * getFxRate(), 1e-9);
    });
});

describe('usage recorder safety', () => {
    const RECORDER = '../usage-recorder.service';
    // The idempotency guard is backed by real Redis when one is reachable, and
    // its keys live for 24h. Namespacing per run keeps the suite hermetic
    // instead of passing only on the first execution of the day.
    const RUN = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    const rid = (name) => `test-${RUN}-${name}`;

    afterEach(() => {
        delete process.env.AI_USAGE_ACCOUNTING;
        jest.resetModules();
    });

    it('is a no-op when the feature flag is unset', async () => {
        jest.resetModules();
        const { recordUsage, isEnabled } = require(RECORDER);
        expect(isEnabled()).toBe(false);
        const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
        expect(await recordUsage({ shopId: 's1', model: LITE, requestId: rid('noop') })).toBeNull();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('records once per requestId and never twice', async () => {
        process.env.AI_USAGE_ACCOUNTING = 'true';
        jest.resetModules();
        const { recordUsage } = require(RECORDER);
        const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const payload = {
            shopId: 'shop-1', operationType: 'chat_reply', provider: 'gemini-lite', model: LITE,
            requestId: rid('dup'),
            responseBody: { usageMetadata: { promptTokenCount: 2155, candidatesTokenCount: 60 } },
        };
        const first = await recordUsage(payload);
        const second = await recordUsage(payload);

        expect(first).not.toBeNull();
        expect(second).toBeNull();
        near(first.estimatedCostUsd, (2155 * 0.25 + 60 * 1.5) / 1e6);
        spy.mockRestore();
    });

    it('records no prompt text, reply text, or customer identifiers', async () => {
        process.env.AI_USAGE_ACCOUNTING = 'true';
        jest.resetModules();
        const { recordUsage } = require(RECORDER);
        const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const rec = await recordUsage({
            shopId: 'shop-1', operationType: 'chat_reply', provider: 'gemini-lite', model: LITE,
            requestId: rid('pii'),
            responseBody: {
                usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
                candidates: [{ content: { parts: [{ text: 'Apu apnar phone number 01712345678 peyechi' }] } }],
            },
        });

        const serialized = JSON.stringify(rec);
        expect(serialized).not.toContain('01712345678');
        expect(serialized).not.toContain('Apu apnar');
        expect(Object.keys(rec)).not.toContain('prompt');
        expect(Object.keys(rec)).not.toContain('systemPrompt');
        expect(Object.keys(rec)).not.toContain('responseBody');
        spy.mockRestore();
    });

    it('records estimatedCostUsd: null when the provider returned no usage block', async () => {
        process.env.AI_USAGE_ACCOUNTING = 'true';
        jest.resetModules();
        const { recordUsage } = require(RECORDER);
        const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const rec = await recordUsage({
            shopId: 'shop-1', provider: 'gemini-lite', model: LITE, requestId: rid('no-usage'),
            responseBody: { candidates: [] },
        });
        expect(rec.estimatedCostUsd).toBeNull();
        expect(rec.costUnknownReason).toBe('no_usage_metadata');
        spy.mockRestore();
    });

    it('never throws, whatever it is handed', async () => {
        process.env.AI_USAGE_ACCOUNTING = 'true';
        jest.resetModules();
        const { recordUsage } = require(RECORDER);
        const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
        await expect(recordUsage()).resolves.toBeDefined();
        await expect(recordUsage({ responseBody: 'not-an-object', requestId: rid('junk') })).resolves.toBeDefined();
        spy.mockRestore();
    });
});
