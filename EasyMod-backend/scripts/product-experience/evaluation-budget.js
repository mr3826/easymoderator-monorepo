'use strict';

// Server-only evaluation accounting. This module reads no environment or credentials
// and never opens a connection. The transport must enforce the supplied token bound.
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const geminiReservationContext = new AsyncLocalStorage();
const GEMINI_HOST = 'generativelanguage.googleapis.com';
const GEMINI_PATH = '/v1beta/models/gemini-3.1-flash-lite:generateContent';
const MAX_GEMINI_REQUEST_BODY_BYTES = 12 * 1024 * 1024;
const IMAGE_TOKEN_UPPER_BOUND = 16384;

const hash = value => createHash('sha256').update(value).digest('hex');
const headerValue = (headers, name) => {
    if (headers && typeof headers.get === 'function') return headers.get(name);
    if (!headers || typeof headers !== 'object') return null;
    const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
};

// Validate the exact serialized GenerateContent body against the reservation.
// The digest is held only in this async call context and is never written to a receipt.
const validateGeminiRequest = (request, reservation) => {
    if (!request || typeof request !== 'object' || typeof request.body !== 'string'
        || Buffer.byteLength(request.body, 'utf8') > MAX_GEMINI_REQUEST_BODY_BYTES) return null;
    let url;
    try { url = new URL(request.url); } catch (_) { return null; }
    if (url.protocol !== 'https:' || url.hostname !== GEMINI_HOST || (url.port && url.port !== '443')
        || url.username || url.password || url.pathname !== GEMINI_PATH || url.search || url.hash
        || String(request.method || '').toUpperCase() !== 'POST' || request.redirect !== 'error') return null;
    const apiKey = headerValue(request.headers, 'x-goog-api-key');
    if (typeof process.env['EM-GEMINI-KEY'] !== 'string' || !process.env['EM-GEMINI-KEY'].trim()
        || apiKey !== process.env['EM-GEMINI-KEY']) return null;
    const contentType = headerValue(request.headers, 'content-type');
    if (typeof contentType !== 'string' || contentType.toLowerCase() !== 'application/json'
        || headerValue(request.headers, 'authorization') || headerValue(request.headers, 'host')) return null;

    let body;
    try { body = JSON.parse(request.body); } catch (_) { return null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['contents', 'generationConfig', 'systemInstruction'].includes(key))
        || Object.prototype.hasOwnProperty.call(body, 'cachedContent')) return null;
    const generation = body.generationConfig;
    if (!generation || typeof generation !== 'object' || Array.isArray(generation)
        || Object.keys(generation).some(key => !['maxOutputTokens', 'temperature'].includes(key))
        || generation.maxOutputTokens !== reservation.maxOutputTokens
        || !Number.isFinite(generation.temperature) || generation.temperature < 0 || generation.temperature > 2) return null;

    let inputBound = 0;
    let imageCount = 0;
    let partCount = 0;
    const readParts = parts => {
        if (!Array.isArray(parts)) return false;
        for (const part of parts) {
            partCount += 1;
            if (partCount > 128 || !part || typeof part !== 'object' || Array.isArray(part)) return false;
            const keys = Object.keys(part);
            if (typeof part.text === 'string' && keys.length === 1 && keys[0] === 'text') {
                inputBound += Buffer.byteLength(part.text, 'utf8');
                continue;
            }
            const inline = part.inlineData;
            if (inline && typeof inline === 'object' && !Array.isArray(inline)
                && keys.length === 1 && keys[0] === 'inlineData'
                && Object.keys(inline).length === 2
                && ['mimeType', 'data'].every(key => Object.prototype.hasOwnProperty.call(inline, key))
                && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(inline.mimeType)
                && typeof inline.data === 'string'
                && /^[A-Za-z0-9+/]+={0,2}$/.test(inline.data)) {
                imageCount += 1;
                if (imageCount > 1 || Buffer.from(inline.data, 'base64').length > 8 * 1024 * 1024) return false;
                inputBound += IMAGE_TOKEN_UPPER_BOUND;
                continue;
            }
            return false;
        }
        return true;
    };

    if (body.systemInstruction !== undefined) {
        const instruction = body.systemInstruction;
        if (!instruction || typeof instruction !== 'object' || Array.isArray(instruction)
            || Object.keys(instruction).length !== 1 || !Array.isArray(instruction.parts)
            || instruction.parts.length === 0
            || instruction.parts.some(part => !part || typeof part !== 'object' || Array.isArray(part)
                || Object.keys(part).length !== 1 || typeof part.text !== 'string')) return null;
        for (const part of instruction.parts) inputBound += Buffer.byteLength(part.text, 'utf8');
    }

    if (!Array.isArray(body.contents) || body.contents.length < 1 || body.contents.length > 64) return null;
    for (const content of body.contents) {
        if (!content || typeof content !== 'object' || Array.isArray(content)
            || Object.keys(content).some(key => !['role', 'parts'].includes(key))
            || !['user', 'model'].includes(content.role) || !readParts(content.parts)) return null;
    }
    if (imageCount !== (reservation.vision ? 1 : 0)
        || inputBound < 1 || inputBound > reservation.inputTokenUpperBound) return null;

    return {
        url: url.toString(),
        method: 'POST',
        bodyBytes: Buffer.byteLength(request.body, 'utf8'),
        bodyDigest: hash(request.body),
        keyDigest: hash(apiKey),
    };
};

const authorizeGeminiEvaluationRequest = request => {
    const reservation = geminiReservationContext.getStore();
    if (!reservation || reservation.permitIssued || process.env.EASYMOD_LIVE_GEMINI_EGRESS !== '1') return false;
    const permit = validateGeminiRequest(request, reservation);
    if (!permit) return false;
    reservation.permit = permit;
    reservation.permitIssued = true;
    return true;
};

const consumeGeminiEvaluationPermit = (url, init = {}) => {
    const reservation = geminiReservationContext.getStore();
    if (!reservation || !reservation.permitIssued || reservation.permitConsumed) return false;
    const permit = reservation.permit;
    const request = { url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect };
    const checked = validateGeminiRequest(request, reservation);
    if (!checked || checked.url !== permit.url || checked.method !== permit.method
        || checked.bodyBytes !== permit.bodyBytes || checked.bodyDigest !== permit.bodyDigest
        || checked.keyDigest !== permit.keyDigest) return false;
    reservation.permitConsumed = true;
    return true;
};

const GEMINI_PRICE_SNAPSHOT = Object.freeze({
    model: 'gemini-3.1-flash-lite',
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 1.5,
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    pinnedAt: '2026-10-21',
});

const HARD_CAPS = Object.freeze({
    ceilingUsd: 10,
    maxRequests: 1000,
    maxVisionRequests: 1000,
    maxConcurrency: 4,
    maxInputTokens: 131072,
    maxOutputTokens: 4096,
    maxRetries: 2,
    maxTimeoutMs: 60000,
});
const DEFAULTS = Object.freeze({
    model: GEMINI_PRICE_SNAPSHOT.model,
    maxRequests: 250,
    maxVisionRequests: 40,
    maxConcurrency: 1,
    maxInputTokens: 32768,
    maxOutputTokens: 1024,
    maxRetries: 0,
    maxTimeoutMs: 30000,
});
const USD_UNITS = 1000000000; // Integer nanodollars; reservations always round up.
const usd = units => units / USD_UNITS;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const clone = value => JSON.parse(JSON.stringify(value));

class BudgetError extends Error {
    constructor(code) {
        super(`Evaluation budget rejected the operation: ${code}.`);
        this.name = 'BudgetError';
        this.code = code;
    }
}

const normalizeConfig = config => {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new BudgetError('INVALID_CONFIG');
    const hasInjectedRates = Object.prototype.hasOwnProperty.call(config, 'rates');
    if (!hasInjectedRates && 'rates' in config) throw new BudgetError('INVALID_CONFIG');
    const allowed = [...Object.keys(DEFAULTS), 'ceilingUsd', 'rates'];
    if (Object.keys(config).some(key => !allowed.includes(key))) throw new BudgetError('INVALID_CONFIG');
    const limits = { ...DEFAULTS, ...config };
    if (!Number.isFinite(limits.ceilingUsd) || limits.ceilingUsd <= 0 || limits.ceilingUsd > HARD_CAPS.ceilingUsd
        || Math.floor(limits.ceilingUsd * USD_UNITS) < 1 || limits.model !== GEMINI_PRICE_SNAPSHOT.model) {
        throw new BudgetError('INVALID_CONFIG');
    }
    for (const key of Object.keys(DEFAULTS).filter(key => key !== 'model')) {
        const minimum = ['maxRetries', 'maxVisionRequests'].includes(key) ? 0 : 1;
        if (!integer(limits[key], minimum, HARD_CAPS[key])) throw new BudgetError('INVALID_CONFIG');
    }
    const rates = hasInjectedRates ? config.rates : GEMINI_PRICE_SNAPSHOT;
    for (const key of ['inputUsdPerMillion', 'outputUsdPerMillion']) {
        if (!Number.isFinite(rates[key]) || rates[key] <= 0 || rates[key] > 1000000) throw new BudgetError('INVALID_CONFIG');
    }
    return Object.freeze({ ...limits, rates: Object.freeze({
        inputUsdPerMillion: rates.inputUsdPerMillion,
        outputUsdPerMillion: rates.outputUsdPerMillion,
    }) });
};

// Missing or malformed usage never frees a reservation. Cached prompt tokens are
// charged at the full input rate so evaluation never relies on a cache discount.
const usageFrom = response => {
    const usage = response?.usageMetadata;
    if (!usage || typeof usage !== 'object') return null;
    const inputTokens = usage.promptTokenCount;
    const outputTokens = usage.candidatesTokenCount;
    const thinkingTokens = usage.thoughtsTokenCount === undefined ? 0 : usage.thoughtsTokenCount;
    if (![inputTokens, outputTokens, thinkingTokens].every(value => integer(value, 0, 1000000000))) return null;
    const total = inputTokens + outputTokens + thinkingTokens;
    if (usage.totalTokenCount !== undefined
        && (!integer(usage.totalTokenCount, 0, 1000000000) || usage.totalTokenCount < total)) return null;
    return { inputTokens, outputTokens, thinkingTokens };
};
const safeRequestMetadata = response => {
    const requestId = typeof response?.requestId === 'string'
        && response.requestId.length <= 128
        && /^[a-zA-Z0-9._:-]+$/.test(response.requestId)
        ? response.requestId
        : null;
    const latencyMs = Number.isSafeInteger(response?.latencyMs)
        && response.latencyMs >= 0
        && response.latencyMs <= 10 * 60 * 1000
        ? response.latencyMs
        : null;
    return { requestId, latencyMs };
};

/**
 * Create one in-memory ledger for one explicitly bounded evaluation run.
 *
 * execute(request, transport) reserves before calling transport(context). A logical
 * operationId is mandatory for retry accounting and is never copied to receipts.
 * transport receives the pinned model, input upper bound, output limit, timeout,
 * retry sequence and AbortSignal, and returns the parsed Gemini response body.
 * No automatic retry is performed. The caller must bound the complete serialized
 * prompt (including raster tokens) by inputTokenUpperBound BEFORE execute().
 * A transport that ignores cancellation keeps its concurrency slot until settled.
 */
const createEvaluationBudget = config => {
    const limits = normalizeConfig(config);
    const officialPricing = !Object.prototype.hasOwnProperty.call(config, 'rates');
    const ceilingUnits = Math.floor(limits.ceilingUsd * USD_UNITS);
    const costUnits = (input, output) => Math.ceil(
        input * limits.rates.inputUsdPerMillion * 1000
        + output * limits.rates.outputUsdPerMillion * 1000,
    );
    const calls = [];
    const operations = new Map();
    const blockedRequests = {};
    let committedUnits = 0;
    let activeRequests = 0;
    let visionRequests = 0;
    let halted = false;

    const reject = code => {
        blockedRequests[code] = (blockedRequests[code] || 0) + 1;
        throw new BudgetError(code);
    };

    const snapshot = () => ({
        schemaVersion: 1,
        model: limits.model,
        pricing: { ...limits.rates, source: officialPricing ? GEMINI_PRICE_SNAPSHOT.source : 'injected-rates', pinnedAt: GEMINI_PRICE_SNAPSHOT.pinnedAt },
        ceilingUsd: usd(ceilingUnits),
        committedUsd: usd(committedUnits),
        remainingUsd: usd(Math.max(0, ceilingUnits - committedUnits)),
        providerReportedUsd: usd(calls.reduce((sum, call) => sum + (call.actualUnits ?? 0), 0)),
        requestCount: calls.length,
        visionRequestCount: visionRequests,
        activeRequests,
        halted,
        limits: Object.fromEntries(Object.keys(DEFAULTS).filter(key => key !== 'model').map(key => [key, limits[key]])),
        blockedRequests: { ...blockedRequests },
        calls: calls.map(({ reservedUnits, chargedUnits, actualUnits, ...safe }) => ({
            ...safe,
            reservedUsd: usd(reservedUnits),
            chargedUsd: usd(chargedUnits),
            providerReportedUsd: actualUnits === null ? null : usd(actualUnits),
        })),
    });

    const execute = async (request, transport) => {
        if (halted) reject('BUDGET_HALTED');
        if (!request || typeof request !== 'object' || Array.isArray(request) || typeof transport !== 'function') reject('INVALID_REQUEST');
        const { operationId, model, inputTokenUpperBound, maxOutputTokens, vision = false, timeoutMs = limits.maxTimeoutMs } = request;
        if (typeof operationId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(operationId) || typeof vision !== 'boolean') reject('INVALID_REQUEST');
        if (model !== limits.model) reject('MODEL_LIMIT');
        if (!integer(inputTokenUpperBound, 1, limits.maxInputTokens)) reject('INPUT_LIMIT');
        if (!integer(maxOutputTokens, 1, limits.maxOutputTokens)) reject('OUTPUT_LIMIT');
        if (!integer(timeoutMs, 1, limits.maxTimeoutMs)) reject('TIMEOUT_LIMIT');
        const operation = operations.get(operationId) || { attempts: 0, active: false, completed: false };
        if (operation.active) reject('OPERATION_IN_FLIGHT');
        if (operation.completed) reject('OPERATION_COMPLETED');
        if (operation.attempts > limits.maxRetries) reject('RETRY_LIMIT');
        if (calls.length >= limits.maxRequests) reject('REQUEST_LIMIT');
        if (vision && visionRequests >= limits.maxVisionRequests) reject('VISION_LIMIT');
        if (activeRequests >= limits.maxConcurrency) reject('CONCURRENCY_LIMIT');
        const reservedUnits = costUnits(inputTokenUpperBound, maxOutputTokens);
        if (reservedUnits > ceilingUnits - committedUnits) reject('SPEND_LIMIT');

        const row = {
            callId: `call-${calls.length + 1}`,
            model,
            vision,
            retrySequence: operation.attempts,
            inputTokenUpperBound,
            maxOutputTokens,
            timeoutMs,
            status: 'pending',
            requestId: null,
            latencyMs: null,
            inputTokens: null,
            outputTokens: null,
            thinkingTokens: null,
            reservedUnits,
            chargedUnits: reservedUnits,
            actualUnits: null,
        };
        calls.push(row);
        committedUnits += reservedUnits;
        activeRequests += 1;
        if (vision) visionRequests += 1;
        operation.attempts += 1;
        operation.active = true;
        operations.set(operationId, operation);
        const abort = new AbortController();
        const context = Object.freeze({
            reservationId: row.callId, model, inputTokenUpperBound, maxOutputTokens,
            timeoutMs, retrySequence: row.retrySequence, signal: abort.signal,
            authorizeGeminiRequest: officialPricing ? authorizeGeminiEvaluationRequest : () => false,
        });
        const release = () => { activeRequests -= 1; operation.active = false; };
        const pending = Promise.resolve().then(() => geminiReservationContext.run({
            model, inputTokenUpperBound, maxOutputTokens, vision,
            permit: null, permitIssued: false, permitConsumed: false,
        }, () => transport(context))).then(
            body => { release(); return body; },
            error => { release(); throw error; },
        );
        let timer;
        const timeoutError = new BudgetError('TRANSPORT_TIMEOUT');
        const timeout = new Promise((_, fail) => {
            timer = setTimeout(() => { fail(timeoutError); abort.abort(); }, timeoutMs);
        });
        let body;
        try {
            body = await Promise.race([pending, timeout]);
        } catch (error) {
            const rateLimited = error?.code === 'GEMINI_RATE_LIMIT';
            const code = error === timeoutError
                ? 'TRANSPORT_TIMEOUT'
                : rateLimited ? 'PROVIDER_RATE_LIMITED' : 'TRANSPORT_FAILED';
            row.status = error === timeoutError
                ? 'transport_timeout'
                : rateLimited ? 'provider_rate_limited' : 'transport_failed';
            if (rateLimited) halted = true;
            throw new BudgetError(code); // Never propagate provider bodies, URLs or errors.
        } finally {
            clearTimeout(timer);
        }
        const usage = usageFrom(body);
        Object.assign(row, safeRequestMetadata(body));
        if (usage) {
            Object.assign(row, usage);
            const actualUnits = costUnits(usage.inputTokens, usage.outputTokens + usage.thinkingTokens);
            const representable = Number.isSafeInteger(actualUnits)
                && Number.isSafeInteger(committedUnits - reservedUnits + actualUnits);
            row.actualUnits = representable ? actualUnits : null;
            const exceeded = !representable || usage.inputTokens > inputTokenUpperBound || usage.outputTokens + usage.thinkingTokens > maxOutputTokens;
            row.chargedUnits = exceeded ? Math.max(reservedUnits, row.actualUnits) : row.actualUnits;
            committedUnits += row.chargedUnits - reservedUnits;
            row.status = exceeded ? 'usage_exceeds_reservation' : 'provider_reported';
            if (exceeded) {
                halted = true;
                throw new BudgetError('USAGE_EXCEEDS_RESERVATION');
            }
        } else {
            row.status = 'usage_unknown';
        }
        operation.completed = true;
        return { response: body, receipt: clone(snapshot().calls.find(call => call.callId === row.callId)) };
    };

    return Object.freeze({ execute, snapshot });
};

module.exports = {
    createEvaluationBudget,
    GEMINI_PRICE_SNAPSHOT,
    BudgetError,
    consumeGeminiEvaluationPermit,
};
