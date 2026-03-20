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
const productSearch = require('../product/product-search.service');
const { incrementFaqHit } = require('../knowledge/knowledge.service');

const CACHE_TTL = parseInt(process.env.INTENT_CACHE_TTL_SECONDS || '300', 10);
const SEMANTIC_THRESHOLD = parseFloat(process.env.SEMANTIC_SCORE_THRESHOLD || '0.82');
const SUMMARY_THRESHOLD = parseInt(process.env.SUMMARY_THRESHOLD || '10', 10);
const ROUTER_DISABLED = process.env.INTENT_ROUTER_DISABLED === 'true';
// Fix #15: configurable FAQ cap in system prompt (was hard-coded 20)
const MAX_FAQ_IN_PROMPT = parseInt(process.env.MAX_FAQ_IN_PROMPT || '50', 10);

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
    preferredProvider,
    imageUrls = []
}) => {
    if (ROUTER_DISABLED) {
        return _callLlm({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, imageUrls });
    }

    // ------------------------------------------------------------------
    // Stage 1: Exact-match response cache (skip for image messages)
    // ------------------------------------------------------------------
    const cacheKey = imageUrls.length > 0 ? null : normalisedKey(shopId, message);
    if (cacheKey) {
        const cachedResponse = await intentCache.get(cacheKey);
        if (cachedResponse) {
            return { response: cachedResponse, confidence: 1.0, source: 'cache' };
        }
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

            // Fix #16: Track FAQ hit — best-effort, non-blocking
            const docId = topHit.metadata?.documentId;
            if (docId && docId.startsWith('faq-')) {
                incrementFaqHit(parseInt(docId.replace('faq-', ''), 10));
            }

            await intentCache.setex(cacheKey, CACHE_TTL, answer);
            return { response: answer, confidence: topHit.score, source: 'faq', provider };
        }
    } catch (_) {
        // RAG unavailable — fall through to full LLM
    }

    // ------------------------------------------------------------------
    // Stage 3: Full LLM call with context
    // ------------------------------------------------------------------
    return _callLlm({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, cacheKey, imageUrls });
};

const _callLlm = async ({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, cacheKey, imageUrls = [] }) => {
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

    let groundedSystemPrompt = systemPrompt;

    // -----------------------------------------------------------------------
    // Vision flow: two-phase for image messages
    //   Phase 1 — extract product attributes from image (fast, cheap, JSON)
    //   Phase 2 — fetch live product data from DB, inject as grounded context
    //   Phase 3 — final LLM response grounded on DB facts (no hallucination)
    // -----------------------------------------------------------------------
    if (imageUrls.length > 0) {
        const attrs = await _extractProductAttributes(imageUrls[0], message);

        if (attrs && shopId) {
            const products = await productSearch.searchByAttributes({
                shopId,
                category: attrs.category,
                color:    attrs.color,
                material: attrs.material,
                query:    attrs.query || message,
                tags:     attrs.tags || [],
                limit: 5
            }).catch(() => []);

            if (products.length > 0) {
                const productContext = productSearch.formatProductsForLlm(products);
                groundedSystemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') +
                    `SHOP PRODUCTS MATCHING THIS IMAGE (live data — use ONLY these facts):\n${productContext}\n\n` +
                    `GROUNDING RULES:\n` +
                    `- Only state prices, stock, and sizes listed above. Never invent or guess.\n` +
                    `- If a product is OUT OF STOCK, say so clearly and do not offer to process an order.\n` +
                    `- If no matching product found, say you couldn't identify the exact product and ask the customer to describe it.`;
            } else {
                // No product match — tell LLM there is no match
                groundedSystemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') +
                    `NOTE: No matching product found in the shop's catalog for this image. ` +
                    `Do not invent any product details. Ask the customer to describe the product they're looking for.`;
            }
        }

        // Build vision content blocks for the final LLM call
        const contentBlocks = imageUrls.map(url => ({ type: 'image_url', url }));
        const customerText = (message && message !== '[image]') ? message : 'What product is this? Can you help me?';
        contentBlocks.push({ type: 'text', text: customerText });
        llmMessages.push({ role: 'user', content: contentBlocks });
    } else {
        llmMessages.push({ role: 'user', content: message });

        // Text-query product search: inject live product data as grounded context.
        // Runs for every text message; empty results = no injection (non-product queries
        // like "hello" return no rows so the guard below keeps the prompt clean).
        if (shopId) {
            const textProducts = await productSearch.searchByAttributes({
                shopId,
                query: message,
                limit: 5
            }).catch(() => []);

            // Guard: only inject if we have at least one product with a real name.
            // Prevents injecting malformed rows from mock/stub returns.
            const validProducts = textProducts.filter(p => p.name);
            if (validProducts.length > 0) {
                const productContext = productSearch.formatProductsForLlm(validProducts);
                groundedSystemPrompt = (groundedSystemPrompt ? groundedSystemPrompt + '\n\n' : '') +
                    `RELEVANT SHOP PRODUCTS (live data — use ONLY these facts):\n${productContext}\n\n` +
                    `GROUNDING RULES:\n` +
                    `- Only state prices, stock, and sizes listed above. Never invent or guess.\n` +
                    `- If a product is OUT OF STOCK, say so clearly and do not offer to process an order.`;
            }
        }
    }

    // For vision requests: prefer OpenAI (gpt-4o-mini) then Gemini, skip Deepseek
    const effectiveProvider = imageUrls.length > 0 ? (preferredProvider || 'openai') : preferredProvider;

    const { text: response, provider } = await llmService.chat({
        systemPrompt: groundedSystemPrompt,
        messages: llmMessages,
        preferredProvider: effectiveProvider,
        maxTokens: 768,
        skipProviders: imageUrls.length > 0 ? ['deepseek'] : []
    });

    if (cacheKey) {
        await intentCache.setex(cacheKey, CACHE_TTL, response);
    }

    return { response, confidence: 0.9, source: 'llm', provider };
};

// ---------------------------------------------------------------------------
// Phase 1: extract product attributes from customer image
// Returns { category, color, material, query, tags } or null on failure
// ---------------------------------------------------------------------------
const _extractProductAttributes = async (imageUrl, customerMessage) => {
    const EXTRACTION_PROMPT = `You are a product image analyzer for an e-commerce platform.
Analyze this product image and return ONLY a JSON object (no markdown, no explanation):
{
  "category": "product type e.g. saree/shirt/panjabi/dress/shoes/bag",
  "color": "main color e.g. blue/red/white (null if unclear)",
  "material": "fabric/material e.g. cotton/silk/polyester (null if unclear)",
  "query": "best search term to find this product",
  "tags": ["max", "5", "search", "tags"]
}`;

    try {
        const { text } = await llmService.chat({
            systemPrompt: EXTRACTION_PROMPT,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', url: imageUrl },
                    { type: 'text', text: customerMessage && customerMessage !== '[image]'
                        ? `Customer message: "${customerMessage}". Identify the product shown.`
                        : 'Identify the product shown in this image.' }
                ]
            }],
            preferredProvider: 'openai',
            skipProviders: ['deepseek'],
            maxTokens: 150
        });

        // Parse JSON response
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        return JSON.parse(cleaned);
    } catch {
        return null; // Attribute extraction is best-effort
    }
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
const buildSystemPrompt = (shopKnowledge, language = 'mixed', hasImages = false) => {
    const { businessInfo = {}, brandingRules = {}, faqs = [] } = shopKnowledge || {};

    const langInstruction =
        language === 'bn'
            ? 'Always respond in Bangla.'
            : language === 'en'
            ? 'Always respond in English.'
            : 'Respond in the same language the customer uses (Bangla, English, or mixed Banglish).';

    const faqSection = faqs.slice(0, MAX_FAQ_IN_PROMPT).map((f) => {
        const q = f.category || f.question || '';
        const a = f.template_en || f.template_bn || f.answer || '';
        return `Q: ${q}\nA: ${a}`;
    }).join('\n\n');

    const imageInstruction = hasImages
        ? 'The customer has sent an image. Look at the image carefully. Identify the product shown, describe it, and help the customer with their query about it (price, availability, ordering, etc.). Respond contextually about the product in the image.'
        : '';

    return [
        `You are a helpful customer service assistant for ${businessInfo.shopName || 'this shop'}.`,
        langInstruction,
        imageInstruction,
        businessInfo.address ? `Address: ${businessInfo.address}` : '',
        businessInfo.phone ? `Phone: ${businessInfo.phone}` : '',
        businessInfo.openingHours ? `Hours: ${businessInfo.openingHours}` : '',
        brandingRules.tone ? `Tone: ${brandingRules.tone}` : '',
        faqSection ? `\n--- Frequently Asked Questions ---\n${faqSection}` : ''
    ].filter(Boolean).join('\n');
};

module.exports = { route, buildSystemPrompt, invalidateSummary, getOrBuildSummary };
