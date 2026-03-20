/**
 * AI1 — LLM Failover Chain
 *
 * Priority: Anthropic (with prompt caching) → OpenAI → Gemini → Deepseek
 *
 * Each provider is tried in order; if a provider throws or returns an error
 * status the next one is attempted. If all fail an error is thrown.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY   — enables Anthropic Claude
 *   OPENAI_API_KEY      — enables OpenAI GPT-4o / GPT-4o-mini
 *   GEMINI_API_KEY      — enables Google Gemini
 *   DEEPSEEK_API_KEY    — enables Deepseek
 *   LLM_DEFAULT_MODEL_ANTHROPIC  (default: claude-3-5-haiku-20241022)
 *   LLM_DEFAULT_MODEL_OPENAI     (default: gpt-4o-mini)
 *   LLM_DEFAULT_MODEL_GEMINI     (default: gemini-1.5-flash)
 *   LLM_DEFAULT_MODEL_DEEPSEEK   (default: deepseek-chat)
 *   LLM_MAX_TOKENS               (default: 1024)
 *   LLM_TEMPERATURE              (default: 0.3)
 */

const ANTHROPIC_MODEL = process.env.LLM_DEFAULT_MODEL_ANTHROPIC || 'claude-3-5-haiku-20241022';
const OPENAI_MODEL = process.env.LLM_DEFAULT_MODEL_OPENAI || 'gpt-4o-mini';
const GEMINI_MODEL = process.env.LLM_DEFAULT_MODEL_GEMINI || 'gemini-1.5-flash';
const DEEPSEEK_MODEL = process.env.LLM_DEFAULT_MODEL_DEEPSEEK || 'deepseek-chat';

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
 * Normalize a message's content blocks for Anthropic's Messages API format.
 * Our internal format: [{ type: 'image_url', url }, { type: 'text', text }]
 * Anthropic format:   [{ type: 'image', source: { type: 'url', url } }, { type: 'text', text }]
 */
const toAnthropicContent = (content) => {
    if (typeof content === 'string') return content;
    return content.map(block => {
        if (block.type === 'image_url') {
            return { type: 'image', source: { type: 'url', url: block.url } };
        }
        return { type: 'text', text: block.text || '' };
    });
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
 * Call Anthropic Claude with optional prompt caching.
 * Prompt caching is activated when `systemPrompt` is provided and
 * ANTHROPIC_API_KEY is set. The system block is marked with
 * cache_control: { type: "ephemeral" } so Anthropic caches it for 5 min.
 *
 * @param {object} params
 * @param {string} params.systemPrompt
 * @param {Array<{role,content}>} params.messages
 * @param {string} [params.model]
 * @param {number} [params.maxTokens]
 * @returns {Promise<string>} assistant text
 */
const callAnthropic = async ({ systemPrompt, messages, model, maxTokens }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const normalizedMessages = messages.map(m => ({
        role: m.role,
        content: toAnthropicContent(m.content)
    }));

    const body = {
        model: model || ANTHROPIC_MODEL,
        max_tokens: maxTokens || MAX_TOKENS,
        temperature: TEMPERATURE,
        messages: normalizedMessages
    };

    if (systemPrompt) {
        body.system = [
            {
                type: 'text',
                text: systemPrompt,
                // Prompt caching: Anthropic caches this block between requests
                cache_control: { type: 'ephemeral' }
            }
        ];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Anthropic error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data?.content?.[0]?.text || '';
};

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

/**
 * Call Deepseek (OpenAI-compatible API).
 */
const callDeepseek = async ({ systemPrompt, messages, model, maxTokens }) => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

    const dsMessages = [];
    if (systemPrompt) dsMessages.push({ role: 'system', content: systemPrompt });
    dsMessages.push(...messages);

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model || DEEPSEEK_MODEL,
            messages: dsMessages,
            max_tokens: maxTokens || MAX_TOKENS,
            temperature: TEMPERATURE
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Deepseek error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
};

// ---------------------------------------------------------------------------
// Failover orchestrator
// ---------------------------------------------------------------------------

const PROVIDERS = [
    { name: 'anthropic', fn: callAnthropic },
    { name: 'openai', fn: callOpenAI },
    { name: 'gemini', fn: callGemini },
    { name: 'deepseek', fn: callDeepseek }
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
    const { preferredProvider, skipProviders = [] } = params;

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

module.exports = { chat, callAnthropic, callOpenAI, callGemini, callDeepseek, transliterateWithLlm };
