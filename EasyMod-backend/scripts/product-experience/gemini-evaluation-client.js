'use strict';

const { decodeDataImage } = require('../../src/utils/safe-media-fetch');
const { GEMINI_PRICE_SNAPSHOT } = require('./evaluation-budget');
const { isRegisteredGenuineRaster } = require('./genuine-photo-fixtures');
const { isRegisteredSyntheticRaster } = require('./synthetic-media-fixtures');

const MODEL = GEMINI_PRICE_SNAPSHOT.model;
const GEMINI_ONLY_SKIP = Object.freeze(['gemini-pro', 'openai']);
const IMAGE_TOKEN_UPPER_BOUND = 16384;
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

class EvaluationClientError extends Error {
    constructor(code) {
        super(`Gemini evaluation request rejected: ${code}.`);
        this.name = 'EvaluationClientError';
        this.code = code;
    }
}

const safeStringBytes = value => Buffer.byteLength(value, 'utf8');

const inspectImageDataUrl = value => {
    if (typeof value !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) {
        throw new EvaluationClientError('RASTER_DATA_URL_REQUIRED');
    }
    if (value.length > Math.ceil(MAX_INLINE_IMAGE_BYTES * 4 / 3) + 64) {
        throw new EvaluationClientError('INVALID_RASTER_IMAGE');
    }
    try {
        const decoded = decodeDataImage(value, { maxBytes: MAX_INLINE_IMAGE_BYTES });
        if (!isRegisteredSyntheticRaster(decoded) && !isRegisteredGenuineRaster(decoded)) {
            throw new Error('Image is not in the registered, checksum-verified evaluation fixture set.');
        }
        return { bytes: decoded.buffer.length, mimeType: decoded.mimeType };
    } catch {
        throw new EvaluationClientError('INVALID_RASTER_IMAGE');
    }
};

const estimateInputUpperBound = ({ systemPrompt = '', messages }, maxInputTokens) => {
    if (typeof systemPrompt !== 'string' || !Array.isArray(messages) || messages.length === 0) {
        throw new EvaluationClientError('INVALID_MESSAGES');
    }
    let inputTokenUpperBound = safeStringBytes(systemPrompt);
    let imageCount = 0;
    for (const message of messages) {
        if (!message || !['user', 'assistant', 'model'].includes(message.role)) {
            throw new EvaluationClientError('INVALID_MESSAGE_ROLE');
        }
        if (Object.keys(message).some(key => !['role', 'content'].includes(key))) {
            throw new EvaluationClientError('UNSUPPORTED_MESSAGE_FIELDS');
        }
        if (typeof message.content === 'string') {
            inputTokenUpperBound += safeStringBytes(message.content);
            continue;
        }
        if (!Array.isArray(message.content)) throw new EvaluationClientError('INVALID_MESSAGE_CONTENT');
        for (const part of message.content) {
            if (part?.type === 'text' && typeof part.text === 'string') {
                if (Object.keys(part).some(key => !['type', 'text'].includes(key))) {
                    throw new EvaluationClientError('UNSUPPORTED_CONTENT_FIELDS');
                }
                inputTokenUpperBound += safeStringBytes(part.text);
            } else if (part?.type === 'image_url') {
                if (message.role !== 'user' || Object.keys(part).some(key => !['type', 'url'].includes(key))) {
                    throw new EvaluationClientError('UNSUPPORTED_CONTENT_FIELDS');
                }
                if (++imageCount > 1) throw new EvaluationClientError('IMAGE_COUNT_LIMIT');
                inspectImageDataUrl(part.url);
                inputTokenUpperBound += IMAGE_TOKEN_UPPER_BOUND;
            } else {
                throw new EvaluationClientError('UNSUPPORTED_CONTENT_BLOCK');
            }
        }
    }
    inputTokenUpperBound = Math.max(1, inputTokenUpperBound);
    if (!Number.isSafeInteger(inputTokenUpperBound) || inputTokenUpperBound > maxInputTokens) {
        throw new EvaluationClientError('INPUT_BOUND_LIMIT');
    }
    return { inputTokenUpperBound, vision: imageCount === 1 };
};

const normalizedUsage = usage => {
    if (!usage || typeof usage !== 'object') return undefined;
    const fields = ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount'];
    const values = Object.fromEntries(fields
        .filter(field => Number.isSafeInteger(usage[field]) && usage[field] >= 0)
        .map(field => [field, usage[field]]));
    return Number.isSafeInteger(values.promptTokenCount) && Number.isSafeInteger(values.candidatesTokenCount)
        ? values
        : undefined;
};

/**
 * Wraps the existing llm.service chat method for one paid Gemini evaluation.
 * It requires the exact EM-GEMINI-KEY source, reserves spend before calling the
 * provider, uses only the pinned Gemini Lite model, and accepts local raster data
 * URLs so customer/provider egress cannot fetch arbitrary media URLs.
 */
const createGeminiEvaluationClient = ({ budget, llm, operationPrefix = 'eval' }) => {
    if (!budget || typeof budget.execute !== 'function' || typeof budget.snapshot !== 'function'
        || typeof llm?.chat !== 'function' || !/^[a-zA-Z0-9_.:-]{1,64}$/.test(operationPrefix)) {
        throw new EvaluationClientError('INVALID_CLIENT_CONFIG');
    }
    let callSequence = 0;

    const chat = async params => {
        if (typeof process.env['EM-GEMINI-KEY'] !== 'string' || !process.env['EM-GEMINI-KEY'].trim()) {
            throw new EvaluationClientError('EM_GEMINI_KEY_UNAVAILABLE');
        }
        if (!params || typeof params !== 'object' || Array.isArray(params)) throw new EvaluationClientError('INVALID_REQUEST');
        const extraFields = Object.keys(params).filter(key => ![
            'systemPrompt', 'messages', 'maxTokens', 'operationId',
            // Router-only hints are ignored because evaluation is strictly pinned.
            'preferredProvider', 'skipProviders', 'cachedContentName', 'returnMetadata', 'usageContext',
        ].includes(key));
        if (extraFields.length) throw new EvaluationClientError('UNSUPPORTED_REQUEST_FIELDS');

        const snapshot = budget.snapshot();
        const maxOutputTokens = params.maxTokens === undefined ? Math.min(512, snapshot.limits.maxOutputTokens) : params.maxTokens;
        if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > snapshot.limits.maxOutputTokens) {
            throw new EvaluationClientError('OUTPUT_LIMIT');
        }
        const { inputTokenUpperBound, vision } = estimateInputUpperBound(params, snapshot.limits.maxInputTokens);
        const operationId = params.operationId || `${operationPrefix}-${++callSequence}`;
        const timeoutMs = Math.min(30000, snapshot.limits.maxTimeoutMs);

        const { response, receipt } = await budget.execute({
            operationId,
            model: MODEL,
            inputTokenUpperBound,
            maxOutputTokens,
            vision,
            timeoutMs,
        }, async context => {
            const result = await llm.chat({
                systemPrompt: params.systemPrompt,
                messages: params.messages,
                maxTokens: context.maxOutputTokens,
                timeoutMs: context.timeoutMs,
                signal: context.signal,
                preferredProvider: 'gemini-lite',
                skipProviders: GEMINI_ONLY_SKIP,
                cachedContentName: undefined,
                returnMetadata: true,
                evaluationEgressAuthorization: context.authorizeGeminiRequest,
            });
            if (!result || typeof result.text !== 'string' || !result.text.trim()
                || result.provider !== 'gemini-lite' || (result.model && result.model !== MODEL)) {
                throw new EvaluationClientError('UNEXPECTED_PROVIDER_RESULT');
            }
            const usageMetadata = normalizedUsage(result.usage);
            return {
                text: result.text,
                provider: result.provider,
                model: MODEL,
                requestId: result.requestId || null,
                latencyMs: Number.isSafeInteger(result.latencyMs) ? result.latencyMs : null,
                ...(usageMetadata ? { usageMetadata } : {}),
            };
        });

        return {
            text: response.text,
            provider: response.provider,
            model: response.model,
            requestId: receipt.requestId,
            latencyMs: receipt.latencyMs,
            usage: response.usageMetadata || null,
            budget: receipt,
        };
    };

    return Object.freeze({ chat });
};

module.exports = {
    createGeminiEvaluationClient,
    estimateInputUpperBound,
    EvaluationClientError,
    MODEL,
};
