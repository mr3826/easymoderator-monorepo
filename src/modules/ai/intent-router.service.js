/**
 * Hybrid Intent Router
 *
 * Routing pipeline (cheapest first):
 *   1. Cache hit  — exact-match cache of (shopId + normalised message)
 *   2. Semantic FAQ search — vector similarity against shop FAQ knowledge base
 *   3. LLM call — full chat completion with RAG context + conversation summary
 *
 * Stateful conversation summaries:
 *   When a conversation exceeds SUMMARY_THRESHOLD messages the older turns are
 *   compressed into a rolling summary stored in the cache, keeping the active
 *   context window small and cheap.
 *
 * Environment variables:
 *   INTENT_CACHE_TTL_SECONDS    (default: 300)  — how long to cache responses
 *   SEMANTIC_SCORE_THRESHOLD    (default: 0.82) — min cosine score for FAQ hit
 *   SUMMARY_THRESHOLD           (default: 10)   — turns before summarisation
 *   INTENT_ROUTER_DISABLED      set to "true" to skip routing (use LLM directly)
 */

const llmService = require('./llm.service');
const ragService = require('../rag/rag.service');
const { MemoryCache } = require('../../config/memory-cache');

const CACHE_TTL = parseInt(process.env.INTENT_CACHE_TTL_SECONDS || '300', 10);
const SEMANTIC_THRESHOLD = parseFloat(process.env.SEMANTIC_SCORE_THRESHOLD || '0.82');
const SUMMARY_THRESHOLD = parseInt(process.env.SUMMARY_THRESHOLD || '10', 10);
const ROUTER_DISABLED = process.env.INTENT_ROUTER_DISABLED === 'true';

// Dedicated cache bucket for intent routing
const intentCache = new MemoryCache();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalisedKey = (shopId, message) =>
    `intent:${shopId}:${message.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)}`;

const summaryCacheKey = (conversationId) => `conv_summary:${conversationId}`;

/**
 * Compress older conversation turns into a rolling text summary using the LLM.
 * Returns the summary string.
 */
const buildSummary = async (history) => {
    if (!history || history.length === 0) return '';

    const transcript = history
        .map((m) => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content || m.message}`)
        .join('\n');

    try {
        const { text } = await llmService.chat({
            systemPrompt: 'Summarise the following customer support conversation in 2–3 sentences, focusing on intent, ordered products, delivery address, and any open issues.',
            messages: [{ role: 'user', content: transcript }],
            maxTokens: 300
        });
        return text.trim();
    } catch (_) {
        // If LLM unavailable, return a simple last-N transcript
        return transcript.split('\n').slice(-6).join('\n');
    }
};

/**
 * Get or build a rolling conversation summary.
 * The summary covers all turns except the latest SUMMARY_THRESHOLD/2 ones
 * (those are kept verbatim for recency).
 */
const getOrBuildSummary = async (conversationId, history) => {
    if (!conversationId || !history || history.length <= SUMMARY_THRESHOLD) return null;

    const cacheKey = summaryCacheKey(conversationId);
    const cached = await intentCache.get(cacheKey);
    if (cached) return cached;

    const olderTurns = history.slice(0, history.length - Math.floor(SUMMARY_THRESHOLD / 2));
    const summary = await buildSummary(olderTurns);

    // Cache for 30 minutes
    await intentCache.setex(cacheKey, 1800, summary);
    return summary;
};

/**
 * Invalidate the summary cache when a new message arrives.
 * Called externally after each message ingestion.
 */
const invalidateSummary = async (conversationId) => {
    await intentCache.del(summaryCacheKey(conversationId));
};

// ---------------------------------------------------------------------------
// Core routing
// ---------------------------------------------------------------------------

/**
 * Route an incoming message and produce an AI response.
 *
 * @param {object} params
 * @param {string} params.shopId
 * @param {string} params.message          - Incoming customer message
 * @param {string} [params.conversationId]
 * @param {Array}  [params.history]        - Recent conversation turns [{role, content|message}]
 * @param {string} [params.language]       - Detected language (en / bn / mixed)
 * @param {string} [params.systemPrompt]   - Pre-built system prompt (shop knowledge)
 * @param {string} [params.preferredProvider] - Force a specific LLM provider
 * @returns {Promise<{ response: string, confidence: number, source: string, provider?: string }>}
 */
const route = async ({
    shopId,
    message,
    conversationId,
    history = [],
    language = 'mixed',
    systemPrompt = '',
    preferredProvider
}) => {
    if (ROUTER_DISABLED) {
        return _callLlm({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider });
    }

    // ------------------------------------------------------------------
    // Stage 1: Exact-match response cache
    // ------------------------------------------------------------------
    const cacheKey = normalisedKey(shopId, message);
    const cachedResponse = await intentCache.get(cacheKey);
    if (cachedResponse) {
        return { response: cachedResponse, confidence: 1.0, source: 'cache' };
    }

    // ------------------------------------------------------------------
    // Stage 2: Semantic FAQ search
    // ------------------------------------------------------------------
    try {
        const ragResult = await ragService.queryData({
            query: message,
            limit: 3,
            shopId
        });

        const topHit = ragResult?.results?.[0];
        if (topHit && topHit.score >= SEMANTIC_THRESHOLD) {
            const faqContent = topHit.content;
            // Build a concise answer using the FAQ snippet + LLM polish
            const { text: answer, provider } = await llmService.chat({
                systemPrompt: systemPrompt || 'You are a helpful shop assistant. Answer using the provided FAQ content.',
                messages: [
                    {
                        role: 'user',
                        content: `FAQ context:\n${faqContent}\n\nCustomer question: ${message}\n\nRespond in language: ${language}`
                    }
                ],
                preferredProvider,
                maxTokens: 512
            });

            await intentCache.setex(cacheKey, CACHE_TTL, answer);
            return { response: answer, confidence: topHit.score, source: 'faq', provider };
        }
    } catch (_) {
        // RAG unavailable — fall through to full LLM
    }

    // ------------------------------------------------------------------
    // Stage 3: Full LLM call with context
    // ------------------------------------------------------------------
    return _callLlm({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, cacheKey });
};

const _callLlm = async ({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, cacheKey }) => {
    // Build active context: rolling summary + recent turns
    const summary = await getOrBuildSummary(conversationId, history);
    const recentTurns = history.length > SUMMARY_THRESHOLD
        ? history.slice(-Math.floor(SUMMARY_THRESHOLD / 2))
        : history;

    const llmMessages = [];

    if (summary) {
        llmMessages.push({
            role: 'user',
            content: `[Conversation summary so far]\n${summary}`
        });
        llmMessages.push({ role: 'assistant', content: 'Understood.' });
    }

    for (const turn of recentTurns) {
        llmMessages.push({
            role: turn.role === 'user' || turn.role === 'customer' ? 'user' : 'assistant',
            content: turn.content || turn.message || ''
        });
    }

    // Current message
    llmMessages.push({ role: 'user', content: message });

    const { text: response, provider } = await llmService.chat({
        systemPrompt,
        messages: llmMessages,
        preferredProvider,
        maxTokens: 768
    });

    if (cacheKey) {
        await intentCache.setex(cacheKey, CACHE_TTL, response);
    }

    return { response, confidence: 0.9, source: 'llm', provider };
};

// ---------------------------------------------------------------------------
// Shop system-prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the static (cacheable) system prompt for a shop.
 * This block is sent as the Anthropic `system` array with `cache_control`,
 * meaning Anthropic caches it for 5 minutes — reducing token costs.
 *
 * @param {object} shopKnowledge  - { businessInfo, brandingRules, faqs }
 * @param {string} language
 * @returns {string}
 */
const buildSystemPrompt = (shopKnowledge, language = 'mixed') => {
    const { businessInfo = {}, brandingRules = {}, faqs = [] } = shopKnowledge || {};

    const langInstruction =
        language === 'bn'
            ? 'Always respond in Bangla.'
            : language === 'en'
            ? 'Always respond in English.'
            : 'Respond in the same language the customer uses (Bangla, English, or mixed Banglish).';

    const faqSection = faqs.slice(0, 20).map((f) => {
        const q = f.category || f.question || '';
        const a = f.template_en || f.template_bn || f.answer || '';
        return `Q: ${q}\nA: ${a}`;
    }).join('\n\n');

    return [
        `You are a helpful customer service assistant for ${businessInfo.shopName || 'this shop'}.`,
        langInstruction,
        businessInfo.address ? `Address: ${businessInfo.address}` : '',
        businessInfo.phone ? `Phone: ${businessInfo.phone}` : '',
        businessInfo.openingHours ? `Hours: ${businessInfo.openingHours}` : '',
        brandingRules.tone ? `Tone: ${brandingRules.tone}` : '',
        faqSection ? `\n--- Frequently Asked Questions ---\n${faqSection}` : ''
    ].filter(Boolean).join('\n');
};

module.exports = { route, buildSystemPrompt, invalidateSummary, getOrBuildSummary };
