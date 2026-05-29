/**
 * AI1 — LLM Failover Chain
 *
 * Priority order:
 *   1. gemini-lite  — gemini-3.1-flash-lite  (primary, fast + cheap)
 *   2. gemini-pro   — gemini-3.1-pro-preview (fallback, high-stakes or lite failure)
 *   3. openai       — gpt-4.1-mini           (final fallback)
 *
 * For high-stakes tasks, pass preferredProvider: 'gemini-pro' to skip lite.
 * For forced OpenAI, pass preferredProvider: 'openai'.
 *
 * Environment variables:
 *   GEMINI_API_KEY               — Google Gemini (required for providers 1 & 2)
 *   OPENAI_API_KEY               — OpenAI (required for provider 3)
 *   LLM_GEMINI_LITE_MODEL        (default: gemini-3.1-flash-lite)
 *   LLM_GEMINI_PRO_MODEL         (default: gemini-3.1-pro-preview)
 *   LLM_OPENAI_MODEL             (default: gpt-4.1-mini)
 *   LLM_MAX_TOKENS               (default: 1024)
 *   LLM_TEMPERATURE              (default: 0.3)
 *   LLM_GEMINI_TIMEOUT_MS        (default: 30000)
 *   LLM_OPENAI_TIMEOUT_MS        (default: 30000)
 */

const { circuitBreaker } = require('./circuit-breaker.service');

const GEMINI_LITE_MODEL = process.env.LLM_GEMINI_LITE_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_PRO_MODEL  = process.env.LLM_GEMINI_PRO_MODEL  || 'gemini-3.1-pro-preview';
const OPENAI_MODEL      = process.env.LLM_OPENAI_MODEL      || 'gpt-4.1-mini';
const MAX_TOKENS        = parseInt(process.env.LLM_MAX_TOKENS  || '1024', 10);
const TEMPERATURE       = parseFloat(process.env.LLM_TEMPERATURE || '0.3');

// ---------------------------------------------------------------------------
// Vision helpers
// ---------------------------------------------------------------------------

const hasVisionContent = (messages) =>
    messages.some(m => Array.isArray(m.content));

const fetchImageAsBase64 = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();
    return { data: Buffer.from(buffer).toString('base64'), mimeType: contentType.split(';')[0] };
};

const toOpenAIContent = (content) => {
    if (typeof content === 'string') return content;
    return content.map(block => {
        if (block.type === 'image_url') {
            return { type: 'image_url', image_url: { url: block.url } };
        }
        return { type: 'text', text: block.text || '' };
    });
};

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

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

const callOpenAI = async ({ systemPrompt, messages, maxTokens }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    const timeoutMs = parseInt(process.env.LLM_OPENAI_TIMEOUT_MS) || 30000;
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
            model: OPENAI_MODEL,
            messages: oaiMessages,
            max_tokens: maxTokens || MAX_TOKENS,
            temperature: TEMPERATURE
        }),
        signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
};

/**
 * Shared Gemini caller. `geminiModel` selects lite vs pro.
 * When `cachedContentName` is set, the system prompt is already server-cached.
 */
const callGemini = async ({ systemPrompt, messages, maxTokens, cachedContentName }, geminiModel) => {
    // Accept either name: code historically read GEMINI_API_KEY, but the
    // provisioning tooling (generate-secrets.*, github-secrets-checklist) sets
    // GOOGLE_GEMINI_API_KEY. Read both so prod isn't silently keyless.
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY (or GOOGLE_GEMINI_API_KEY) not set');

    const timeoutMs = parseInt(process.env.LLM_GEMINI_TIMEOUT_MS) || 30000;
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

    if (cachedContentName) {
        body.cachedContent = cachedContentName;
    } else if (systemPrompt) {
        body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini (${geminiModel}) error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

// ---------------------------------------------------------------------------
// Provider chain
// ---------------------------------------------------------------------------

const PROVIDERS = [
    { name: 'gemini-lite', fn: (params) => callGemini(params, GEMINI_LITE_MODEL) },
    { name: 'gemini-pro',  fn: (params) => callGemini(params, GEMINI_PRO_MODEL)  },
    { name: 'openai',      fn: (params) => callOpenAI(params)                     },
];

/**
 * Call LLM with automatic failover: lite → pro → openai.
 *
 * @param {object} params
 * @param {string} params.systemPrompt
 * @param {Array<{role,content}>} params.messages
 * @param {string} [params.preferredProvider] - 'gemini-lite' | 'gemini-pro' | 'openai'
 *   Pass 'gemini-pro' for high-stakes tasks to skip lite entirely.
 * @param {string[]} [params.skipProviders] - Exclude specific providers from this call.
 * @param {number} [params.maxTokens]
 * @param {string} [params.cachedContentName] - Gemini Context Cache handle.
 * @returns {Promise<{ text: string, provider: string }>}
 */
const chat = async (params) => {
    const { preferredProvider, skipProviders = [] } = params;

    let providers = PROVIDERS.filter(p => !skipProviders.includes(p.name));

    if (preferredProvider) {
        const pref = providers.find(p => p.name === preferredProvider);
        if (pref) {
            providers = [pref, ...providers.filter(p => p.name !== preferredProvider)];
        }
    }

    const errors = [];
    for (const { name, fn } of providers) {
        try {
            const text = await circuitBreaker.callWithBreaker(name, () => fn(params));
            return { text, provider: name };
        } catch (err) {
            errors.push(`${name}: ${err.message}`);
        }
    }

    throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
};

/**
 * LLM-assisted Banglish → Bangla transliteration.
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

module.exports = { chat, callOpenAI, callGemini, transliterateWithLlm, GEMINI_LITE_MODEL, GEMINI_PRO_MODEL, OPENAI_MODEL };
