'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { decodeDataImage } = require('../../src/utils/safe-media-fetch');
const { GEMINI_PRO_PRICE_SNAPSHOT } = require('./evaluation-budget');

const MODEL = GEMINI_PRO_PRICE_SNAPSHOT.model;
const sourceSha256 = () => crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const FINISH_REASONS = new Set([
    'FINISH_REASON_UNSPECIFIED', 'STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER',
    'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY',
    'UNEXPECTED_TOOL_CALL', 'NO_IMAGE', 'MODEL_ARMOR', 'IMAGE_PROHIBITED_CONTENT',
    'IMAGE_RECITATION', 'LANGUAGE', 'PROMPT_TRUNCATED',
]);
const safeRequestId = response => {
    for (const name of ['x-goog-request-id', 'x-request-id', 'request-id']) {
        const value = response?.headers?.get?.(name);
        if (typeof value === 'string' && value.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(value)) return value;
    }
    return null;
};

const geminiParts = content => {
    if (typeof content === 'string') return [{ text: content }];
    if (!Array.isArray(content)) throw new Error('Gemini Pro diagnostic content is invalid.');
    return content.map(part => {
        if (part?.type === 'image_url') {
            const { buffer, mimeType } = decodeDataImage(part.url, { maxBytes: 8 * 1024 * 1024 });
            return { inlineData: { mimeType, data: buffer.toString('base64') } };
        }
        if (part?.type === 'text') return { text: part.text || '' };
        throw new Error('Gemini Pro diagnostic content is unsupported.');
    });
};

const createGeminiProDiagnosticTransport = ({ fetchImpl = (...args) => global.fetch(...args) } = {}) => Object.freeze({
    chat: async params => {
        if (params?.preferredProvider !== 'gemini-pro' || params?.thinkingLevel !== 'low'
            || params?.returnMetadata !== true || !Array.isArray(params.messages)
            || !Array.isArray(params.skipProviders) || params.skipProviders.join(',') !== 'gemini-lite,openai'
            || !Number.isSafeInteger(params.maxTokens) || params.maxTokens < 1
            || typeof params.evaluationEgressAuthorization !== 'function'
            || typeof process.env['EM-GEMINI-KEY'] !== 'string' || !process.env['EM-GEMINI-KEY'].trim()) {
            throw new Error('Gemini Pro diagnostic transport rejected its configuration.');
        }
        const temperature = parseFloat(process.env.LLM_TEMPERATURE || '0.3');
        if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
            throw new Error('Gemini Pro diagnostic transport rejected its configuration.');
        }
        const body = {
            contents: params.messages.map(message => ({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: geminiParts(message.content),
            })),
            generationConfig: {
                maxOutputTokens: params.maxTokens,
                temperature,
                thinkingConfig: { thinkingLevel: 'low' },
            },
        };
        if (typeof params.systemPrompt === 'string' && params.systemPrompt) {
            body.systemInstruction = { parts: [{ text: params.systemPrompt }] };
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
        const request = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env['EM-GEMINI-KEY'] },
            body: JSON.stringify(body),
            redirect: 'error',
            signal: params.signal,
        };
        if (params.evaluationEgressAuthorization({ url, ...request }) !== true) {
            throw new Error('Gemini Pro diagnostic permit rejected.');
        }
        const startedAt = Date.now();
        const response = await fetchImpl(url, request);
        if (!response.ok) {
            const error = new Error('Gemini Pro diagnostic provider request failed.');
            if (response.status === 429) error.code = 'GEMINI_RATE_LIMIT';
            throw error;
        }
        const payload = await response.json();
        const candidate = payload?.candidates?.[0];
        const blockReason = payload?.promptFeedback?.blockReason;
        if (blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
            throw new Error('Gemini Pro diagnostic response was blocked.');
        }
        const finishReason = FINISH_REASONS.has(candidate?.finishReason) ? candidate.finishReason : null;
        if (candidate?.finishReason && ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']
            .includes(String(candidate.finishReason).toUpperCase())) {
            throw new Error('Gemini Pro diagnostic response was blocked.');
        }
        const text = (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
            .map(part => typeof part?.text === 'string' ? part.text : '')
            .filter(Boolean)
            .join('')
            .trim();
        if (!text) throw new Error('Gemini Pro diagnostic response contained no usable text.');
        return {
            text,
            model: MODEL,
            provider: 'gemini-pro',
            requestId: safeRequestId(response),
            latencyMs: Date.now() - startedAt,
            usage: payload?.usageMetadata,
            finishReason,
        };
    },
});

module.exports = { createGeminiProDiagnosticTransport, MODEL, sourceSha256 };
