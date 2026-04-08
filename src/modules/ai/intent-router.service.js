/**
 * Hybrid Intent Router
 *
 * Routing pipeline (cheapest first):
 *   1. Cache hit  — exact-match cache of (shopId + normalised message)
 *   2. Semantic FAQ search — vector similarity against shop FAQ knowledge base
 *   3. LLM call — full chat completion with RAG context + conversation summary
 *
 * Context window: last 10 messages passed verbatim. No LLM summarization —
 *   BD F-commerce conversations are 3–8 turns; step_data holds all order state.
 *
 * Environment variables:
 *   INTENT_CACHE_TTL_SECONDS    (default: 300)  — how long to cache responses
 *   SEMANTIC_SCORE_THRESHOLD    (default: 0.82) — min cosine score for FAQ hit
 *   INTENT_ROUTER_DISABLED      set to "true" to skip routing (use LLM directly)
 */

const llmService = require('./llm.service');
const { MemoryCache } = require('../../config/memory-cache');
const productSearch = require('../product/product-search.service');
const { incrementFaqHit } = require('../knowledge/knowledge.service');
const CACHE_TTL = parseInt(process.env.INTENT_CACHE_TTL_SECONDS || '300', 10);
const SEMANTIC_THRESHOLD = parseFloat(process.env.SEMANTIC_SCORE_THRESHOLD || '0.82');
const CONTEXT_WINDOW = 10; // last N messages passed to LLM verbatim
const ROUTER_DISABLED = process.env.INTENT_ROUTER_DISABLED === 'true';
// Fix #15: configurable FAQ cap in system prompt (was hard-coded 20)
const MAX_FAQ_IN_PROMPT = parseInt(process.env.MAX_FAQ_IN_PROMPT || '50', 10);

// Dedicated cache bucket for intent routing
const intentCache = new MemoryCache();

// Keywords that indicate the message is about a product (price, availability, order).
// Used to skip the DB product-search on messages like "hello", "thanks", "how are you".
const PRODUCT_INTENT_KEYWORDS = [
    // English
    'available', 'price', 'cost', 'stock', 'buy', 'order', 'purchase',
    'want', 'need', 'looking', 'show', 'color', 'colour', 'size', 'delivery',
    'shipping', 'discount', 'offer', 'product', 'item',
    // Banglish / Bengali
    'ache', 'nai', 'daam', 'dam', 'lagbe', 'nibo', 'chai', 'dekhao',
    'pabo', 'koto', 'takar', 'taka', 'paoa', 'pawa', 'deliver', 'stock'
];

const hasProductIntent = (message) => {
    const lower = message.toLowerCase();
    return PRODUCT_INTENT_KEYWORDS.some(kw => lower.includes(kw));
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalisedKey = (shopId, message) =>
    `intent:${shopId}:${message.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)}`;

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
 * @param {number} [params.confidenceThreshold] - Per-shop FAQ match threshold (0–1, overrides env default)
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
    imageUrls = [],
    // Bug #11: accept per-shop threshold so shops can tune for Banglish noise.
    // Falls back to SEMANTIC_THRESHOLD (env var) if not provided.
    confidenceThreshold
}) => {
    // Resolve effective threshold: per-shop value wins over global env default.
    // Shop stores it as 0–100 integer (e.g. 75 means 0.75); convert accordingly.
    const effectiveThreshold = confidenceThreshold != null
        ? (confidenceThreshold > 1 ? confidenceThreshold / 100 : confidenceThreshold)
        : SEMANTIC_THRESHOLD;

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
    // Stage 2: Keyword FAQ search (fast DB lookup — no vector infrastructure)
    // BD shops have 10-50 FAQs; SQL keyword match is sufficient and instant.
    // ------------------------------------------------------------------
    try {
        const { FaqResponse } = require('../entities');
        const { Op } = require('sequelize');

        // Tokenise: keep ASCII words + Bengali Unicode chars, drop punctuation
        const tokens = message
            .toLowerCase()
            .replace(/[^\w\u0980-\u09FF\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2);

        if (tokens.length > 0) {
            const orClauses = tokens.flatMap(token => [
                { category:    { [Op.iLike]: `%${token}%` } },
                { template_en: { [Op.iLike]: `%${token}%` } },
                { template_bn: { [Op.iLike]: `%${token}%` } }
            ]);

            const candidates = await FaqResponse.findAll({
                where: { shop_id: shopId, is_active: true, [Op.or]: orClauses },
                order: [['priority', 'DESC'], ['use_count', 'DESC']],
                limit: 5
            });

            if (candidates.length > 0) {
                // Score each FAQ by fraction of query tokens that appear in its text
                const scored = candidates.map(faq => {
                    const hay = [faq.category, faq.template_en, faq.template_bn]
                        .filter(Boolean).join(' ').toLowerCase();
                    const hits = tokens.filter(t => hay.includes(t)).length;
                    return { faq, score: hits / tokens.length };
                });
                scored.sort((a, b) => b.score - a.score);
                const best = scored[0];

                // Accept if ≥30% of tokens matched, or at least 2 absolute keyword hits
                const hitCount = Math.round(best.score * tokens.length);
                if (best.score >= 0.3 || hitCount >= 2) {
                    const faqContent = [best.faq.category, best.faq.template_en, best.faq.template_bn]
                        .filter(Boolean).join('\n');

                    const { text: answer, provider } = await llmService.chat({
                        systemPrompt: systemPrompt || 'You are a helpful shop assistant. Answer using the provided FAQ content.',
                        messages: [{
                            role: 'user',
                            content: `FAQ context:\n${faqContent}\n\nCustomer question: ${message}\n\nRespond in language: ${language}`
                        }],
                        preferredProvider,
                        maxTokens: 512
                    });

                    // Fix #16: Track FAQ hit — best-effort, non-blocking
                    incrementFaqHit(best.faq.id);

                    if (cacheKey) await intentCache.setex(cacheKey, CACHE_TTL, answer);
                    return { response: answer, confidence: best.score, source: 'faq', provider };
                }
            }
        }
    } catch (_) {
        // DB unavailable — fall through to full LLM
    }

    // ------------------------------------------------------------------
    // Stage 3: Full LLM call with context
    // ------------------------------------------------------------------
    return _callLlm({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, cacheKey, imageUrls });
};

const _callLlm = async ({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, cacheKey, imageUrls = [] }) => {
    const recentTurns = history.slice(-CONTEXT_WINDOW);

    const llmMessages = [];

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

        // Text-query product search: only run when the message looks like a product query.
        // Skips DB lookup for greetings, thanks, and other non-product messages.
        if (shopId && hasProductIntent(message)) {
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

    // For vision requests: prefer OpenAI (gpt-4o has better vision than Gemini Flash for product images)
    const effectiveProvider = imageUrls.length > 0 ? (preferredProvider || 'openai') : preferredProvider;

    const { text: response, provider } = await llmService.chat({
        systemPrompt: groundedSystemPrompt,
        messages: llmMessages,
        preferredProvider: effectiveProvider,
        maxTokens: 768
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
// BD-market persona instruction blocks
const TONE_PERSONA_INSTRUCTIONS = {
    friendly_bd: `You are a helpful Bangladeshi shop assistant for {shopName}.
Personality rules:
- Respond naturally in Banglish (mix of Bengali and English, like real BD sellers do)
- Use warm, informal addressing: "Apu", "Vai", "Bhai", "Boss" based on context
- Keep replies SHORT — 1-3 sentences max, like WhatsApp/Facebook chat
- Sound like a real person, NOT a call center or chatbot
- Common phrases to use naturally:
  • Confirming order: "Ji apu, apnar order confirm hoyeche ✅"
  • Asking address: "Address ta deben please? 🙏"
  • Product available: "Ji, stock ache! Ebar order korte paren"
  • Out of stock: "Sorry apu, ekhon stock nai. 2-3 din por available hobe"
  • Payment: "Advance ta bKash/Nagad korte hobe: 01XXXXXXXXX"
  • Delivery time: "Dhaka te 1-2 din, dhaka er bairer 2-3 din lagbe"
  • Gratitude: "Dhonnobad apu! 😊 Apnar order ta shorto process kore dibo"
- Never use formal phrases like "Dear Customer", "We regret to inform you", "Please be advised"
- If you don't know an answer, say: "Ek second wait koren, check kore bolchi"`,

    shop_assistant: `You are a helpful shop assistant for {shopName}.
- Be friendly and professional
- Respond in the customer's language (Bangla, English, or Banglish)
- Keep responses concise and helpful
- Focus on product information and order assistance`,

    formal: `You are a professional customer service representative for {shopName}.
- Respond formally and politely
- Use proper Bangla or English as appropriate
- Maintain a professional tone at all times`
};

const buildSystemPrompt = (shopKnowledge, language = 'mixed', hasImages = false, tonePersona = 'friendly_bd') => {
    const { businessInfo = {}, brandingRules = {}, faqs = [] } = shopKnowledge || {};

    const shopName = businessInfo.shopName || 'this shop';

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

    const contextInstruction = `IMPORTANT: Use the conversation history above to maintain context.
- Reference previous questions and answers to avoid repetition
- Acknowledge what was already discussed
- Maintain consistency with earlier statements
- Use customer info and past preferences when relevant`;

    // Resolve persona: explicit tonePersona > brandingRules.tone > default
    const resolvedPersona = tonePersona || brandingRules.tone_persona || 'friendly_bd';
    const personaTemplate = TONE_PERSONA_INSTRUCTIONS[resolvedPersona] || TONE_PERSONA_INSTRUCTIONS.friendly_bd;
    const personaInstruction = personaTemplate.replace('{shopName}', shopName);

    return [
        personaInstruction,
        langInstruction,
        imageInstruction,
        contextInstruction,
        businessInfo.address ? `Address: ${businessInfo.address}` : '',
        businessInfo.phone ? `Phone: ${businessInfo.phone}` : '',
        businessInfo.openingHours ? `Hours: ${businessInfo.openingHours}` : '',
        // Legacy tone override (if shop set a custom freeform tone)
        brandingRules.tone && !TONE_PERSONA_INSTRUCTIONS[brandingRules.tone] ? `Tone: ${brandingRules.tone}` : '',
        faqSection ? `\n--- Frequently Asked Questions ---\n${faqSection}` : ''
    ].filter(Boolean).join('\n');
};

module.exports = { route, buildSystemPrompt };
