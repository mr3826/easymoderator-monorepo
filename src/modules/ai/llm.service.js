/**
 * AI1 — LLM Failover Chain
 *
 * Priority: Gemini (multimodal, primary) → OpenAI (fallback)
 *
 * Gemini 2.0 Flash is the primary provider: it handles image+text (product photos),
 * has good Bengali language support, and is cost-effective. OpenAI is the fallback.
 *
 * Each provider is tried in order; if a provider throws or returns an error
 * status the next one is attempted. If all fail an error is thrown.
 *
 * Environment variables:
 *   GEMINI_API_KEY      — enables Google Gemini (primary)
 *   OPENAI_API_KEY      — enables OpenAI GPT-4o / GPT-4o-mini (fallback)
 *   LLM_DEFAULT_MODEL_GEMINI     (default: gemini-2.0-flash)
 *   LLM_DEFAULT_MODEL_OPENAI     (default: gpt-4o-mini)
 *   LLM_MAX_TOKENS               (default: 1024)
 *   LLM_TEMPERATURE              (default: 0.3)
 */

const OPENAI_MODEL = process.env.LLM_DEFAULT_MODEL_OPENAI || 'gpt-4o-mini';
const GEMINI_MODEL = process.env.LLM_DEFAULT_MODEL_GEMINI || 'gemini-2.0-flash';

// ---------------------------------------------------------------------------
// Vision helpers
// ---------------------------------------------------------------------------

/**
 * Check if any message in the array has vision content blocks.
 */
const hasVisionContent = (messages) =>
    messages.some(m => Array.isArray(m.content));

/**
 * Fetch an image URL and return base64-encoded data + mime type.
 * Used for providers that don't accept raw HTTP image URLs (e.g. Gemini REST).
 */
const fetchImageAsBase64 = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();
    return { data: Buffer.from(buffer).toString('base64'), mimeType: contentType.split(';')[0] };
};

/**
 * Normalize a message's content blocks for OpenAI's chat API format.
 * OpenAI format: [{ type: 'image_url', image_url: { url } }, { type: 'text', text }]
 */
const toOpenAIContent = (content) => {
    if (typeof content === 'string') return content;
    return content.map(block => {
        if (block.type === 'image_url') {
            return { type: 'image_url', image_url: { url: block.url } };
        }
        return { type: 'text', text: block.text || '' };
    });
};

/**
 * Normalize a message's content blocks for Gemini's generateContent format.
 * Gemini requires base64 inline data for non-GCS URLs — we fetch and encode.
 * Returns a promise of parts array.
 */
const toGeminiParts = async (content) => {
    if (typeof content === 'string') return [{ text: content }];
    const parts = [];
    for (const block of content) {
        if (block.type === 'image_url') {
            const { data, mimeType } = await fetchImageAsBase64(block.url);
            parts.push({ inlineData: { mimeType, data } });
        } else {
            parts.push({ text: block.text || '' });
        }
    }
    return parts;
};

const MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || '1024', 10);
const TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE || '0.3');

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

/**
 * Call OpenAI (GPT-4o-mini by default).
 */
const callOpenAI = async ({ systemPrompt, messages, model, maxTokens }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    const oaiMessages = [];
    if (systemPrompt) oaiMessages.push({ role: 'system', content: systemPrompt });
    oaiMessages.push(...messages.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model || OPENAI_MODEL,
            messages: oaiMessages,
            max_tokens: maxTokens || MAX_TOKENS,
            temperature: TEMPERATURE
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
};

/**
 * Call Google Gemini.
 */
const callGemini = async ({ systemPrompt, messages, model, maxTokens }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');

    const geminiModel = model || GEMINI_MODEL;
    const contents = await Promise.all(messages.map(async (m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: await toGeminiParts(m.content)
    })));

    const body = {
        contents,
        generationConfig: {
            maxOutputTokens: maxTokens || MAX_TOKENS,
            temperature: TEMPERATURE
        }
    };

    if (systemPrompt) {
        body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

// ---------------------------------------------------------------------------
// Failover orchestrator
// ---------------------------------------------------------------------------

const PROVIDERS = [
    { name: 'gemini', fn: callGemini },
    { name: 'openai', fn: callOpenAI }
];

/**
 * Call LLM with automatic failover through the provider chain.
 *
 * @param {object} params
 * @param {string} params.systemPrompt  - Cached system/knowledge block
 * @param {Array<{role,content}>} params.messages - Conversation turns
 * @param {string} [params.preferredProvider] - Force a specific provider first
 * @param {string} [params.model]
 * @param {number} [params.maxTokens]
 * @returns {Promise<{ text: string, provider: string }>}
 */
const chat = async (params) => {
    const envPreferredProvider = process.env.LLM_PROVIDER;
    const { preferredProvider = envPreferredProvider, skipProviders = [] } = params;

    let providers = PROVIDERS.filter(p => !skipProviders.includes(p.name));
    if (preferredProvider) {
        const pref = providers.find((p) => p.name === preferredProvider);
        if (pref) {
            providers = [pref, ...providers.filter((p) => p.name !== preferredProvider)];
        }
    }

    const errors = [];
    for (const { name, fn } of providers) {
        try {
            const text = await fn(params);
            return { text, provider: name };
        } catch (err) {
            errors.push(`${name}: ${err.message}`);
        }
    }

    throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
};

/**
 * LLM-assisted Banglish → Bangla transliteration (used by banglish.service).
 */
const transliterateWithLlm = async (banglish, ruleBasedResult) => {
    const { text } = await chat({
        systemPrompt: 'You are a Banglish to Bangla transliterator. Return only the corrected Bangla text, no explanation.',
        messages: [
            {
                role: 'user',
                content: `Banglish input: "${banglish}"\nRule-based attempt: "${ruleBasedResult}"\n\nReturn the correct Bangla transliteration as a single line.`
            }
        ],
        maxTokens: 256
    });
    return text.trim();
};

module.exports = { chat, callOpenAI, callGemini, transliterateWithLlm };
