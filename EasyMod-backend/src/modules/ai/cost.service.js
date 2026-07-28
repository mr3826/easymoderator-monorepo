'use strict';

/**
 * AI cost accounting — pure functions over a versioned pricing table.
 *
 * Prices live in pricing-table.json (versioned + dated + sourced). Nothing in
 * this module hardcodes a rate, so a provider price change is a data edit, not
 * a code change, and historical invoices stay reproducible by pinning a version.
 *
 * Two hard rules, both enforced by tests:
 *   1. An UNKNOWN model never costs $0. It returns costUsd: null with
 *      unknownModel: true, so a mis-typed model id shows up as a hole in the
 *      ledger instead of silently understating spend.
 *   2. MISSING provider usage metadata never costs $0 either — same treatment.
 */

const PRICING = require('./pricing-table.json');

const PER_MILLION = 1_000_000;

/** Usage provenance, most trustworthy first. Never mix these silently. */
const USAGE_SOURCE = Object.freeze({
    PROVIDER_REPORTED: 'provider_reported',
    TOKENIZER_ESTIMATE: 'tokenizer_estimate',
    SCENARIO_ASSUMPTION: 'scenario_assumption',
});

const getPricingVersion = () => PRICING.version;
const getFxRate = () => PRICING.fx.USD_BDT;
const getModelPricing = (model) => PRICING.models[model] || null;
const listModels = () => Object.keys(PRICING.models);

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Cost of one provider call.
 *
 * `inputTokens` is the provider's TOTAL prompt token count (Gemini
 * promptTokenCount / OpenAI prompt_tokens). `cachedInputTokens` is the subset
 * of it that was served from cache — it is subtracted, never added.
 *
 * @param {object} u
 * @param {string} u.model
 * @param {number} [u.inputTokens]        total prompt tokens (incl. image + cached)
 * @param {number} [u.cachedInputTokens]  subset of inputTokens billed at the cached rate
 * @param {number} [u.outputTokens]       completion tokens
 * @param {number} [u.reasoningTokens]    billed at the output rate (OpenAI reasoning models)
 * @param {number} [u.embeddingTokens]    for kind:'embedding' models
 * @param {'standard'|'batch'} [u.tier]
 * @returns {{costUsd:number|null, costBdt:number|null, breakdown:object,
 *            model:string, provider:string|null, pricingVersion:string,
 *            unknownModel?:boolean, missingUsage?:boolean, reason?:string}}
 */
function calculateCost(u = {}) {
    const { model, tier = 'standard' } = u;
    const price = getModelPricing(model);

    const base = { model: model || null, provider: price ? price.provider : null, pricingVersion: PRICING.version };

    if (!price) {
        return { ...base, costUsd: null, costBdt: null, breakdown: {}, unknownModel: true, reason: `No pricing entry for model "${model}"` };
    }

    const hasAnyUsage = ['inputTokens', 'outputTokens', 'embeddingTokens', 'reasoningTokens']
        .some((k) => Number.isFinite(u[k]));
    if (!hasAnyUsage) {
        return { ...base, costUsd: null, costBdt: null, breakdown: {}, missingUsage: true, reason: 'No usage metadata supplied — cost is unknown, not zero' };
    }

    const batch = tier === 'batch';
    const rateIn = batch && Number.isFinite(price.batchInput) ? price.batchInput : price.input;
    const rateOut = batch && Number.isFinite(price.batchOutput) ? price.batchOutput : price.output;
    const rateCached = Number.isFinite(price.cachedInput) ? price.cachedInput : rateIn;

    const totalIn = num(u.inputTokens);
    const cachedIn = Math.min(num(u.cachedInputTokens), totalIn);
    const freshIn = totalIn - cachedIn;
    const out = num(u.outputTokens) + num(u.reasoningTokens);
    const embed = num(u.embeddingTokens);

    const breakdown = {
        inputUsd: (freshIn * rateIn) / PER_MILLION,
        cachedInputUsd: (cachedIn * rateCached) / PER_MILLION,
        outputUsd: (out * (rateOut || 0)) / PER_MILLION,
        embeddingUsd: (embed * rateIn) / PER_MILLION,
    };

    const costUsd = breakdown.inputUsd + breakdown.cachedInputUsd + breakdown.outputUsd + breakdown.embeddingUsd;

    return {
        ...base,
        tier,
        costUsd,
        costBdt: costUsd * PRICING.fx.USD_BDT,
        breakdown,
        rates: { input: rateIn, cachedInput: rateCached, output: rateOut },
        ...(price.status === 'retired' ? { retiredModel: true, retiredOn: price.retiredOn } : {}),
    };
}

/**
 * Normalise a raw provider response body into the internal usage schema.
 * Handles Gemini `usageMetadata` and OpenAI `usage` shapes. Returns null when
 * the provider sent no usage block at all — callers must treat that as
 * "unknown", never as zero.
 */
function normalizeProviderUsage(provider, responseBody) {
    if (!responseBody || typeof responseBody !== 'object') return null;

    if (provider === 'openai') {
        const usage = responseBody.usage;
        if (!usage) return null;
        return {
            inputTokens: usage.prompt_tokens ?? 0,
            cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
            imageTokens: 0,
            sourceOfUsage: USAGE_SOURCE.PROVIDER_REPORTED,
        };
    }

    // Gemini (both gemini-lite and gemini-pro share this shape)
    const meta = responseBody.usageMetadata;
    if (!meta) return null;
    const imageTokens = (meta.promptTokensDetails || [])
        .filter((d) => d.modality === 'IMAGE')
        .reduce((sum, d) => sum + (d.tokenCount || 0), 0);
    return {
        inputTokens: meta.promptTokenCount ?? 0,
        // Gemini omits the field entirely on a cache miss — absent means zero cached.
        cachedInputTokens: meta.cachedContentTokenCount ?? 0,
        outputTokens: meta.candidatesTokenCount ?? 0,
        reasoningTokens: meta.thoughtsTokenCount ?? 0,
        imageTokens,
        sourceOfUsage: USAGE_SOURCE.PROVIDER_REPORTED,
    };
}

/**
 * Sum a list of per-call costs. Any entry with an unknown cost makes the total
 * `partial` — the caller must surface that rather than report a confident sum.
 */
function sumCosts(results = []) {
    let costUsd = 0;
    let unknown = 0;
    for (const r of results) {
        if (!r || r.costUsd == null) { unknown++; continue; }
        costUsd += r.costUsd;
    }
    return {
        costUsd,
        costBdt: costUsd * PRICING.fx.USD_BDT,
        calls: results.length,
        unknownCalls: unknown,
        partial: unknown > 0,
        pricingVersion: PRICING.version,
    };
}

/** USD → BDT with an explicit, overridable rate. Never mixes currencies silently. */
function usdToBdt(usd, rate = PRICING.fx.USD_BDT) {
    if (!Number.isFinite(usd)) return null;
    return usd * rate;
}

module.exports = {
    USAGE_SOURCE,
    calculateCost,
    normalizeProviderUsage,
    sumCosts,
    usdToBdt,
    getPricingVersion,
    getFxRate,
    getModelPricing,
    listModels,
    PRICING,
};
