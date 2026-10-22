'use strict';

const { createEvaluationBudget, GEMINI_PRICE_SNAPSHOT, GEMINI_PRO_PRICE_SNAPSHOT, BudgetError } = require('./evaluation-budget');

const MODEL = 'gemini-3.1-flash-lite';
const makeBudget = (overrides = {}) => createEvaluationBudget({ ceilingUsd: 1, ...overrides });
const request = (overrides = {}) => ({ operationId: 'case-1', model: MODEL, inputTokenUpperBound: 100, maxOutputTokens: 10, ...overrides });
const response = (overrides = {}) => ({ usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 4, thoughtsTokenCount: 2 }, ...overrides });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

describe('isolated Gemini evaluation budget', () => {
    test('pins the official text/image input and output price snapshot', () => {
        expect(GEMINI_PRICE_SNAPSHOT).toMatchObject({ model: MODEL, inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5 });
        expect(GEMINI_PRICE_SNAPSHOT.source).toBe('https://ai.google.dev/gemini-api/docs/pricing');
        expect(Object.isFrozen(GEMINI_PRICE_SNAPSHOT)).toBe(true);
    });

    test('pins Gemini Pro at its official under-200k standard rates', () => {
        expect(GEMINI_PRO_PRICE_SNAPSHOT).toMatchObject({
            model: 'gemini-3.1-pro-preview', inputUsdPerMillion: 2, outputUsdPerMillion: 12,
            source: 'https://ai.google.dev/gemini-api/docs/pricing', pinnedAt: '2026-10-22',
        });
        expect(Object.isFrozen(GEMINI_PRO_PRICE_SNAPSHOT)).toBe(true);
    });

    test.each([undefined, 0, -1, NaN, Infinity, 10.01])('rejects an invalid or absent spend ceiling: %s', ceilingUsd => {
        expect(() => createEvaluationBudget({ ceilingUsd })).toThrow(BudgetError);
    });

    test.each([
        { maxRequests: 0 }, { maxVisionRequests: -1 }, { maxConcurrency: 0 },
        { maxInputTokens: Infinity }, { maxOutputTokens: 0 }, { maxRetries: 3 },
        { maxTimeoutMs: 0 }, { model: 'unsupported-model' }, { model: 'toString' }, { model: 'constructor' },
        { rates: { inputUsdPerMillion: 0, outputUsdPerMillion: 1 } },
    ])('rejects unbounded configuration %j', config => {
        expect(() => makeBudget(config)).toThrow(BudgetError);
    });

    test('rejects inherited pricing so hidden custom rates cannot authorize live evaluation', () => {
        const config = Object.create({ rates: { inputUsdPerMillion: 0.000001, outputUsdPerMillion: 0.000001 } });
        config.ceilingUsd = 1;
        expect(() => createEvaluationBudget(config)).toThrow(BudgetError);
    });

    test('reserves worst-case input plus output before entering transport and reconciles thinking tokens', async () => {
        const budget = makeBudget();
        const result = await budget.execute(request(), async context => {
            expect(budget.snapshot().committedUsd).toBeCloseTo(0.00004, 9);
            expect(context).toMatchObject({ model: MODEL, inputTokenUpperBound: 100, maxOutputTokens: 10, timeoutMs: 30000 });
            expect(context.signal).toBeInstanceOf(AbortSignal);
            return response();
        });
        expect(result.response).toEqual(response());
        expect(result.receipt).toMatchObject({ status: 'provider_reported', inputTokens: 80, outputTokens: 4, thinkingTokens: 2, chargedUsd: 0.000029 });
        expect(budget.snapshot()).toMatchObject({ requestCount: 1, activeRequests: 0, committedUsd: 0.000029, estimatedProviderChargeUsd: 0.000029, providerReportedUsd: 0.000029 });
    });

    test('reserves Gemini Pro usage at its distinct official rate card', async () => {
        const model = GEMINI_PRO_PRICE_SNAPSHOT.model;
        const budget = makeBudget({ model });
        const result = await budget.execute(request({ model }), async context => {
            expect(context.model).toBe(model);
            expect(budget.snapshot().committedUsd).toBeCloseTo(0.00032, 9);
            return response();
        });
        expect(result.receipt).toMatchObject({ model, reservedUsd: 0.00032, estimatedProviderChargeUsd: 0.000232 });
        expect(budget.snapshot()).toMatchObject({ model, pricing: { model, inputUsdPerMillion: 2, outputUsdPerMillion: 12 } });
    });

    test('persists a campaign reservation before transport and reconciles the estimate afterward', async () => {
        const snapshots = [];
        const budget = createEvaluationBudget({ ceilingUsd: 1 }, { onSnapshot: snapshot => snapshots.push(snapshot) });
        await budget.execute(request(), async () => {
            expect(snapshots).toHaveLength(1);
            expect(snapshots[0]).toMatchObject({ requestCount: 1, activeRequests: 1, committedUsd: 0.00004 });
            return response();
        });
        expect(snapshots).toHaveLength(2);
        expect(snapshots[1]).toMatchObject({ activeRequests: 0, estimatedProviderChargeUsd: 0.000029 });
    });

    test('stops before transport if the campaign ledger rejects its reservation', async () => {
        const transport = jest.fn();
        const budget = createEvaluationBudget({ ceilingUsd: 1 }, { onSnapshot: () => { throw new Error('CAMPAIGN_LIMIT_EXCEEDED'); } });
        await expect(budget.execute(request(), transport)).rejects.toMatchObject({ code: 'CAMPAIGN_LEDGER_REJECTED' });
        expect(transport).not.toHaveBeenCalled();
        expect(budget.snapshot()).toMatchObject({ halted: true, requestCount: 1, activeRequests: 0 });
    });

    test('refuses work before transport when its worst case exceeds remaining spend', async () => {
        const budget = makeBudget({ ceilingUsd: 0.00003 });
        const transport = jest.fn();
        await expect(budget.execute(request(), transport)).rejects.toMatchObject({ code: 'SPEND_LIMIT' });
        expect(transport).not.toHaveBeenCalled();
        expect(budget.snapshot()).toMatchObject({ requestCount: 0, committedUsd: 0 });
    });

    test('conservatively retains missing, malformed, and failed usage reservations', async () => {
        const budget = makeBudget({ maxRetries: 1 });
        for (const [index, body] of [{}, { usageMetadata: { promptTokenCount: 10 } }, { usageMetadata: { promptTokenCount: -1, candidatesTokenCount: 2 } }].entries()) {
            await budget.execute(request({ operationId: `case-${index}` }), async () => body);
        }
        await expect(budget.execute(request({ operationId: 'failure' }), async () => { throw new Error('PRIVATE_CUSTOMER_SECRET'); })).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
        const snapshot = budget.snapshot();
        expect(snapshot.committedUsd).toBeCloseTo(0.00016, 9);
        expect(snapshot.providerReportedUsd).toBe(0);
        expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_CUSTOMER_SECRET');
        expect(snapshot.calls.map(call => call.status)).toEqual(['usage_unknown', 'usage_unknown', 'usage_unknown', 'transport_failed']);
    });

    test('classifies Gemini rate limits separately and halts subsequent paid requests', async () => {
        const budget = makeBudget({ maxRetries: 1 });
        const rateLimit = Object.assign(new Error('sensitive provider detail'), { code: 'GEMINI_RATE_LIMIT' });
        await expect(budget.execute(request(), async () => { throw rateLimit; }))
            .rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
        expect(budget.snapshot()).toMatchObject({
            halted: true,
            requestCount: 1,
            calls: [{ status: 'provider_rate_limited', providerReportedUsd: null }],
        });
        expect(JSON.stringify(budget.snapshot())).not.toContain('sensitive provider detail');
        await expect(budget.execute(request({ operationId: 'after-rate-limit' }), async () => response()))
            .rejects.toMatchObject({ code: 'BUDGET_HALTED' });
        expect(budget.snapshot().requestCount).toBe(1);
    });

    test('retained reservations prevent later work from overrunning the ceiling', async () => {
        const budget = makeBudget({ ceilingUsd: 10, rates: { inputUsdPerMillion: 1000000, outputUsdPerMillion: 1000000 } });
        await budget.execute(request({ inputTokenUpperBound: 5, maxOutputTokens: 5 }), async () => ({}));
        const transport = jest.fn();
        await expect(budget.execute(request({ operationId: 'case-2', inputTokenUpperBound: 1, maxOutputTokens: 1 }), transport)).rejects.toMatchObject({ code: 'SPEND_LIMIT' });
        expect(transport).not.toHaveBeenCalled();
        expect(budget.snapshot().committedUsd).toBe(10);
    });

    test.each([
        [{ model: 'other' }, 'MODEL_LIMIT'],
        [{ inputTokenUpperBound: 101 }, 'INPUT_LIMIT'],
        [{ maxOutputTokens: 11 }, 'OUTPUT_LIMIT'],
        [{ timeoutMs: 1001 }, 'TIMEOUT_LIMIT'],
        [{ inputTokenUpperBound: NaN }, 'INPUT_LIMIT'],
        [{ vision: 'true' }, 'INVALID_REQUEST'],
    ])('rejects a request outside configured caps before transport: %j', async (overrides, code) => {
        const budget = makeBudget({ maxInputTokens: 100, maxOutputTokens: 10, maxTimeoutMs: 1000 });
        const transport = jest.fn();
        await expect(budget.execute(request({ timeoutMs: 1000, ...overrides }), transport)).rejects.toMatchObject({ code });
        expect(transport).not.toHaveBeenCalled();
    });

    test('enforces cumulative request and vision caps', async () => {
        const budget = makeBudget({ maxRequests: 2, maxVisionRequests: 1 });
        await budget.execute(request({ vision: true }), async () => response());
        const transport = jest.fn();
        await expect(budget.execute(request({ operationId: 'vision-2', vision: true }), transport)).rejects.toMatchObject({ code: 'VISION_LIMIT' });
        await budget.execute(request({ operationId: 'text-2' }), async () => response());
        await expect(budget.execute(request({ operationId: 'text-3' }), transport)).rejects.toMatchObject({ code: 'REQUEST_LIMIT' });
        expect(transport).not.toHaveBeenCalled();
        expect(budget.snapshot()).toMatchObject({ requestCount: 2, visionRequestCount: 1 });
    });

    test('blocks concurrency and duplicate in-flight logical operations', async () => {
        const budget = makeBudget({ maxConcurrency: 2 });
        const pending = deferred();
        const first = budget.execute(request(), () => pending.promise);
        await expect(budget.execute(request(), jest.fn())).rejects.toMatchObject({ code: 'OPERATION_IN_FLIGHT' });
        const second = budget.execute(request({ operationId: 'case-2' }), () => pending.promise);
        await expect(budget.execute(request({ operationId: 'case-3' }), jest.fn())).rejects.toMatchObject({ code: 'CONCURRENCY_LIMIT' });
        pending.resolve(response());
        await Promise.all([first, second]);
        expect(budget.snapshot().activeRequests).toBe(0);
    });

    test('returns the matching receipt when concurrent transports complete out of order', async () => {
        const budget = makeBudget({ maxConcurrency: 2 });
        const pending = deferred();
        const first = budget.execute(request(), () => pending.promise);
        const second = await budget.execute(request({ operationId: 'case-2', vision: true }), async () => response());
        pending.resolve(response());
        const result = await first;
        expect(second.receipt).toMatchObject({ callId: 'call-2', vision: true });
        expect(result.receipt).toMatchObject({ callId: 'call-1', vision: false });
    });

    test('halts safely if impossible provider usage cannot be represented as integer money', async () => {
        const budget = makeBudget({ ceilingUsd: 10, rates: { inputUsdPerMillion: 1000000, outputUsdPerMillion: 1000000 } });
        await expect(budget.execute(request({ inputTokenUpperBound: 1, maxOutputTokens: 1 }), async () => response({
            usageMetadata: { promptTokenCount: 1000000000, candidatesTokenCount: 1000000000, thoughtsTokenCount: 1000000000 },
        }))).rejects.toMatchObject({ code: 'USAGE_EXCEEDS_RESERVATION' });
        expect(budget.snapshot()).toMatchObject({ halted: true, committedUsd: 2, providerReportedUsd: 0 });
        expect(budget.snapshot().calls[0].providerReportedUsd).toBeNull();
    });

    test('counts each manual retry and refuses retries after the cap or successful completion', async () => {
        const budget = makeBudget({ maxRetries: 1 });
        await expect(budget.execute(request(), async () => { throw new Error('private'); })).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
        await expect(budget.execute(request(), async () => { throw new Error('private'); })).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
        await expect(budget.execute(request(), jest.fn())).rejects.toMatchObject({ code: 'RETRY_LIMIT' });
        await budget.execute(request({ operationId: 'success' }), async () => response());
        await expect(budget.execute(request({ operationId: 'success' }), jest.fn())).rejects.toMatchObject({ code: 'OPERATION_COMPLETED' });
        expect(budget.snapshot().calls.map(call => call.retrySequence)).toEqual([0, 1, 0]);
    });

    test('aborts on timeout, retains cost and holds concurrency until transport settles', async () => {
        jest.useFakeTimers();
        try {
            const budget = makeBudget({ maxTimeoutMs: 10 });
            const pending = deferred();
            let signal;
            const first = budget.execute(request({ timeoutMs: 10 }), context => { signal = context.signal; return pending.promise; });
            const rejection = expect(first).rejects.toMatchObject({ code: 'TRANSPORT_TIMEOUT' });
            await jest.advanceTimersByTimeAsync(10);
            await rejection;
            expect(signal.aborted).toBe(true);
            expect(budget.snapshot()).toMatchObject({ activeRequests: 1, committedUsd: 0.00004 });
            await expect(budget.execute(request({ operationId: 'case-2', timeoutMs: 10 }), jest.fn())).rejects.toMatchObject({ code: 'CONCURRENCY_LIMIT' });
            pending.resolve(response());
            await Promise.resolve();
            await Promise.resolve();
            expect(budget.snapshot()).toMatchObject({ activeRequests: 0, committedUsd: 0.00004 });
            expect(budget.snapshot().calls[0].status).toBe('transport_timeout');
        } finally { jest.useRealTimers(); }
    });

    test('freezes subsequent work if provider usage exceeds reserved input or output', async () => {
        const budget = makeBudget();
        await expect(budget.execute(request(), async () => response({ usageMetadata: { promptTokenCount: 101, candidatesTokenCount: 10 } }))).rejects.toMatchObject({ code: 'USAGE_EXCEEDS_RESERVATION' });
        expect(budget.snapshot().committedUsd).toBeCloseTo(0.00004025, 10);
        await expect(budget.execute(request({ operationId: 'case-2' }), jest.fn())).rejects.toMatchObject({ code: 'BUDGET_HALTED' });
    });

    test('receipts contain safe numerical metadata only and snapshots cannot mutate state', async () => {
        const budget = makeBudget();
        await budget.execute(request({ operationId: 'PRIVATE_OPERATION' }), async () => response({
            candidates: [{ content: 'PRIVATE_CUSTOMER_SECRET' }],
            modelVersion: 'PRIVATE_MODEL',
            requestId: 'req-123.safe',
            latencyMs: 42,
        }));
        const snapshot = budget.snapshot();
        const serialized = JSON.stringify(snapshot);
        expect(serialized).not.toMatch(/PRIVATE_|candidates|content|operationId|usageMetadata/);
        expect(snapshot.calls[0]).toMatchObject({ requestId: 'req-123.safe', latencyMs: 42 });
        snapshot.calls[0].chargedUsd = 999;
        snapshot.requestCount = 999;
        expect(budget.snapshot().requestCount).toBe(1);
        expect(budget.snapshot().calls[0].chargedUsd).toBe(0.000029);
    });

    test('drops request identifiers and latency that do not fit the receipt contract', async () => {
        const budget = makeBudget();
        await budget.execute(request(), async () => response({ requestId: 'private customer text', latencyMs: -1 }));
        expect(budget.snapshot().calls[0]).toMatchObject({ requestId: null, latencyMs: null });
    });
});
