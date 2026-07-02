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
const { scrubPII } = require('./prompt-sanitizer.service');
const bertClient = require('./bert-client.service');
const geminiCache = require('./gemini-cache.service');
const CACHE_TTL = parseInt(process.env.INTENT_CACHE_TTL_SECONDS || '1800', 10);
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
    // Banglish / Bengali (romanised)
    'ache', 'nai', 'daam', 'dam', 'lagbe', 'nibo', 'chai', 'dekhao',
    'pabo', 'koto', 'takar', 'taka', 'paoa', 'pawa', 'deliver', 'stock',
    // Bengali script — without these, a customer typing "এই জামার দাম কত?"
    // never triggers the live DB product/price lookup → the LLM hallucinates a price.
    'দাম', 'মূল্য', 'কত', 'টাকা', 'দেখান', 'দেখাও', 'আছে', 'নাই', 'নেই',
    'কিনব', 'কিনবো', 'লাগবে', 'চাই', 'অর্ডার', 'সাইজ', 'মাপ', 'রং', 'কালার',
    'স্টক', 'ডেলিভারি', 'ছাড়', 'অফার', 'প্রোডাক্ট', 'পাব', 'পাবো', 'নিব', 'নিবো'
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

// Warm BD-market greeting responses (no LLM needed for simple hellos)
const GREETING_REPLIES = {
    bn:    'আসসালামু আলাইকুম! কেমন আছেন? কিভাবে সাহায্য করতে পারি? 😊',
    en:    'Hello! How can I help you today? 😊',
    mixed: 'Assalamu alaikum! Ki help korbo apnake? 😊',
};

const _greetingReply = (language = 'mixed') =>
    GREETING_REPLIES[language] || GREETING_REPLIES.mixed;

// Regex fast-path for unambiguous greetings — runs before BERT so we still
// short-circuit when the local ML service is unavailable or low-confidence.
// Tight intentionally: only short messages that are PURELY greeting tokens.
// If the customer wrote "hi, is this saree available?", product intent wins
// and the LLM handles it.
const GREETING_PATTERN = /^(?:hi|hii+|hey+|hello+|yo|salam|assalam(?:u)?\s*alaikum|walaikum\s*assalam|nomoshkar|নমস্কার|আসসালামু\s*আলাইকুম|ওয়ালাইকুম\s*আসসালাম|হ্যালো|হাই|good\s*(?:morning|afternoon|evening|night))[\s!.,👋😊🙏]*$/i;

const isPlainGreeting = (message) => {
    if (!message || typeof message !== 'string') return false;
    const trimmed = message.trim();
    if (trimmed.length === 0 || trimmed.length > 40) return false;
    if (hasProductIntent(trimmed)) return false;
    return GREETING_PATTERN.test(trimmed);
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
    // Stage 1.5: Exact-match order lookup (DB query, zero LLM cost)
    // Handles "where is my order 12345?" style queries — the most common
    // BD f-commerce message type.
    // ------------------------------------------------------------------
    if (!imageUrls.length) {
        const orderMatch = message.match(/\b(\d{5,8})\b/);
        if (orderMatch) {
            try {
                const { Order } = require('../entities');
                const order = await Order.findOne({
                    where: { shop_id: shopId, order_number: orderMatch[1] },
                    attributes: ['order_number', 'order_status', 'payment_status', 'delivery_status', 'delivery_tracking_code'],
                });
                if (order) {
                    const statusLine = [
                        `Order #${order.order_number}`,
                        `Status: ${order.order_status || 'processing'}`,
                        order.payment_status ? `Payment: ${order.payment_status}` : null,
                        order.delivery_status ? `Delivery: ${order.delivery_status}` : null,
                        order.delivery_tracking_code ? `Tracking: ${order.delivery_tracking_code}` : null,
                    ].filter(Boolean).join(' | ');
                    if (cacheKey) await intentCache.setex(cacheKey, CACHE_TTL, statusLine);
                    return { response: statusLine, confidence: 1.0, source: 'exact_match' };
                }
            } catch (_) { /* DB unavailable — fall through */ }
        }
    }

    // ------------------------------------------------------------------
    // Stage 1.7: Regex greeting fast-path (runs before BERT so it works
    // even when the local ML service is down or low-confidence).
    // Only fires on short messages that are PURELY greeting tokens.
    // ------------------------------------------------------------------
    if (!imageUrls.length && isPlainGreeting(message)) {
        const greetingResponse = _greetingReply(language);
        if (cacheKey) await intentCache.setex(cacheKey, CACHE_TTL, greetingResponse);
        return { response: greetingResponse, confidence: 0.95, source: 'greeting_fastpath' };
    }

    // ------------------------------------------------------------------
    // Stage 1.8: BanglaBERT fast-path (local ML, ~0ms cost)
    // Handles greetings with a templated reply so we skip the LLM entirely.
    // High-confidence non-greeting intents set a hint for downstream stages.
    // ------------------------------------------------------------------
    if (!imageUrls.length) {
        const bertResult = await bertClient.classify(message, shopId);
        if (bertResult && bertResult.confidence >= 0.85) {
            if (bertResult.primaryIntent === 'greeting') {
                const greetingResponse = _greetingReply(language);
                if (cacheKey) await intentCache.setex(cacheKey, CACHE_TTL, greetingResponse);
                return { response: greetingResponse, confidence: 0.9, source: 'bert' };
            }
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
                    return {
                        response: answer,
                        confidence: best.score,
                        source: 'faq',
                        provider,
                        sourceReferences: [{
                            kind: 'faq',
                            id: String(best.faq.id),
                            title: best.faq.category || null,
                            score: Number(best.score.toFixed(3)),
                        }],
                    };
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
    // Accumulates RAG / product sources that ground this reply. Surfaced back
    // to the worker so agents reviewing the AI message in the inbox can see
    // which knowledge drove the answer (architect §16).
    const sourceReferences = [];
    // Product IDs already injected as live grounded facts — prevents the RAG
    // tier from re-injecting (or worse, dumping the price-less embedding text of)
    // a product the DB product-search already grounded.
    const injectedProductIds = new Set();

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
                for (const p of products) {
                    if (p && p.id) {
                        injectedProductIds.add(String(p.id));
                        sourceReferences.push({ kind: 'product', id: String(p.id), title: p.name || null });
                    }
                }
            } else {
                // No product match — tell LLM there is no match
                groundedSystemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') +
                    `NOTE: No matching product found in the shop's catalog for this image. ` +
                    `Do not invent any product details. Ask the customer to describe the product they're looking for.`;
            }
        }

        // Build vision content blocks for the final LLM call
        const contentBlocks = imageUrls.map(url => ({ type: 'image_url', url }));
        const customerText = scrubPII((message && message !== '[image]') ? message : 'What product is this? Can you help me?');
        contentBlocks.push({ type: 'text', text: customerText });
        llmMessages.push({ role: 'user', content: contentBlocks });
    } else {
        llmMessages.push({ role: 'user', content: scrubPII(message) });

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
                for (const p of validProducts) {
                    if (p && p.id) {
                        injectedProductIds.add(String(p.id));
                        sourceReferences.push({ kind: 'product', id: String(p.id), title: p.name || null });
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // RAG knowledge base injection
    // Inject top-K non-analytics knowledge chunks (FAQ, delivery, policies, etc.)
    // for all queries that don't have direct DB answers.
    // Analytics (order status) already returned early via Stage 1.
    // -----------------------------------------------------------------------
    if (shopId && !imageUrls.length) {
        try {
            const { queryData } = require('../rag/rag.service');
            const ragResult = await queryData({ query: message, limit: 4, shopId });
            if (ragResult.success && ragResult.results.length > 0) {
                const usedResults = ragResult.results.filter(r => r.score > 0.5);

                // Split product-type hits from knowledge hits. Product embeddings
                // deliberately EXCLUDE price/stock (they change too often), so the
                // stored product text must NOT be fed to the LLM as ground truth —
                // doing so is a direct cause of hallucinated prices. Instead we
                // re-fetch matched products LIVE from the DB (with current price).
                const productHitIds = [];
                const knowledgeResults = [];
                for (const r of usedResults) {
                    const md = r.metadata || {};
                    if (md.type === 'product' && md.product_id) {
                        const id = String(md.product_id);
                        if (!injectedProductIds.has(id)) productHitIds.push(id);
                    } else if (r.content) {
                        knowledgeResults.push(r);
                    }
                }

                const ragSnippets = knowledgeResults.map(r => r.content.trim()).join('\n---\n');
                if (ragSnippets) {
                    groundedSystemPrompt = (groundedSystemPrompt ? groundedSystemPrompt + '\n\n' : '') +
                        `KNOWLEDGE BASE CONTEXT (use this to answer customer questions about the shop, delivery, products, and policies):\n${ragSnippets}\n\n` +
                        `IMPORTANT: Only use the knowledge above. If the answer is not in the context, say you don't know or ask the customer to contact support.`;

                    for (const r of knowledgeResults) {
                        const md = r.metadata || {};
                        sourceReferences.push({
                            kind: 'rag',
                            id: md.documentId || md.id || null,
                            title: md.title || md.source || md.kind || null,
                            score: typeof r.score === 'number' ? Number(r.score.toFixed(3)) : null,
                        });
                    }
                }

                // Convert semantic product hits into LIVE grounded facts (price, stock,
                // sizes from the DB). This is what stops "what's the price of X?" from
                // hallucinating when X was matched via the vector store rather than the
                // SQL product-search above.
                if (productHitIds.length) {
                    const liveProducts = await productSearch
                        .getProductsByIds(productHitIds, shopId)
                        .catch(() => []);
                    const validLive = liveProducts.filter(p => p && p.name);
                    if (validLive.length) {
                        const productContext = productSearch.formatProductsForLlm(validLive);
                        groundedSystemPrompt = (groundedSystemPrompt ? groundedSystemPrompt + '\n\n' : '') +
                            `RELEVANT SHOP PRODUCTS (live data — use ONLY these facts):\n${productContext}\n\n` +
                            `GROUNDING RULES:\n` +
                            `- Only state prices, stock, and sizes listed above. Never invent or guess.\n` +
                            `- If a product is OUT OF STOCK, say so clearly and do not offer to process an order.`;
                        for (const p of validLive) {
                            injectedProductIds.add(String(p.id));
                            sourceReferences.push({ kind: 'product', id: String(p.id), title: p.name || null });
                        }
                    }
                }
            }
        } catch (_) { /* RAG unavailable — continue without it */ }
    }

    const effectiveProvider = preferredProvider;

    // Attempt to use Gemini context cache for the base system prompt.
    // When a cache hit occurs, inject any dynamic product grounding as a
    // prefixed context block in the messages array (Gemini reads cachedContent
    // as its system context, so we must not also send systemInstruction).
    const cachedContentName = await geminiCache.getOrCreate(shopId, systemPrompt).catch(() => null);

    let finalSystemPrompt = groundedSystemPrompt;
    let finalMessages = llmMessages;

    if (cachedContentName) {
        // The base system prompt is cached — only send dynamic grounding (if any)
        // as a context-injection block prepended to the conversation.
        const dynamicGrounding = groundedSystemPrompt !== systemPrompt
            ? groundedSystemPrompt.slice(systemPrompt.length).trim()
            : null;

        finalSystemPrompt = null; // do not re-send the cached system prompt
        if (dynamicGrounding) {
            finalMessages = [
                { role: 'user', content: `[Context for this message only]\n${dynamicGrounding}` },
                { role: 'model', content: 'Understood. I will use this context.' },
                ...llmMessages,
            ];
        }
    }

    const { text: response, provider } = await llmService.chat({
        systemPrompt:      finalSystemPrompt,
        messages:          finalMessages,
        preferredProvider: effectiveProvider,
        cachedContentName,
        maxTokens:         768
    });

    if (cacheKey) {
        await intentCache.setex(cacheKey, CACHE_TTL, response);
    }

    return {
        response,
        confidence: 0.9,
        source: 'llm',
        provider,
        sourceReferences: sourceReferences.length ? sourceReferences : null,
    };
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
- Reply in the customer's language and in ONE language only: Bengali when they write Bengali or Banglish, English when they write English. NEVER send the same message in two languages and NEVER add a translation after your reply (no "Bangla / English" side by side).
- When replying in Bengali you may use the natural Banglish register real BD sellers use, but keep it to a single message — do not duplicate it in English.
- Use warm, informal addressing: "Apu", "Vai", "Bhai", "Boss" based on context
- Keep replies SHORT — 1-3 sentences max, like Messenger/Instagram chat
- Sound like a real person, NOT a call center or chatbot
- Common phrases to use naturally:
  • Ready to buy: "Kon product ta order korben janan — product er nam likhe 'order korbo' pathan 😊" (the separate order system then collects their details)
  • Helping decide: "Ei ta best seller apu, onek er pochonder 😊"
  • Product available: "Ji, stock ache! Ebar order korte paren"
  • Out of stock: "Sorry apu, ekhon stock nai. 2-3 din por available hobe"
  • Payment (use ONLY the methods in the SHOP PAYMENT & DELIVERY section — never invent one): COD shop → "Cash on delivery, product hate peye taka diben 😊"
  • Delivery time: "Dhaka te 1-2 din, dhaka er bairer 2-3 din lagbe"
  • Gratitude: "Dhonnobad apu! 😊"
- IMPORTANT — you do NOT take orders yourself and you CANNOT create one. A separate order system collects name, phone, address and payment step by step; if it has not taken over, NO order exists. Therefore:
  • NEVER say an order is "confirmed", "placed", "started", "noted" or "processing" — phrases like "order ta start kore dicchi" or "note kore niyechi" are FORBIDDEN, they make the customer believe an order exists when it does not.
  • NEVER ask for the customer's name, phone number, delivery address or payment details.
  • If they send details anyway, do NOT acknowledge them as an order — ask them to send the product name with "order korbo" so the order system can start.
  • When the customer is asked whether they want to add more products, a negative answer ("no", "না", "আর লাগবে না") means they are done adding products and want to continue checkout. Do not cancel the order unless the customer explicitly uses cancellation language like "cancel order" or "অর্ডার বাতিল".
  Your job is to answer product/price/availability questions and guide them to start the order.
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

/**
 * @param {object}  shopKnowledge
 * @param {string}  language
 * @param {boolean} hasImages
 * @param {string}  tonePersona
 * @param {Array}   [relevantFaqs]  - Pre-filtered FAQs from RAG (top 3-5).
 *                                    When provided, overrides the full faqs dump so
 *                                    only query-relevant entries are sent to the LLM.
 * @param {string}  [operatingContext] - Authoritative live payment/delivery facts
 *                                    (see shop-operating-context.service). Placed
 *                                    high in the prompt so it overrides stale default
 *                                    FAQs / persona examples about payment methods.
 */
const buildSystemPrompt = (shopKnowledge, language = 'mixed', hasImages = false, tonePersona = 'friendly_bd', relevantFaqs = null, operatingContext = '') => {
    const { businessInfo = {}, brandingRules = {}, faqs = [] } = shopKnowledge || {};

    const shopName = businessInfo.shopName || 'this shop';

    const langInstruction =
        language === 'bn'
            ? 'Always respond in Bangla, in a single language — never add an English translation.'
            : language === 'en'
            ? 'Always respond in English only.'
            : 'Respond in the customer\'s language using a SINGLE language per reply — never send the same message in both Bangla and English, and never append a translation.';

    // Use pre-filtered RAG results when available; fall back to full FAQ dump.
    const faqSource = relevantFaqs !== null ? relevantFaqs : faqs.slice(0, MAX_FAQ_IN_PROMPT);
    const faqSection = faqSource.map((f) => {
        const q = f.category || f.question || '';
        const a = f.template_en || f.template_bn || f.answer || '';
        return `Q: ${q}\nA: ${a}`;
    }).join('\n\n');

    const imageInstruction = hasImages
        ? 'The customer has sent an image. If it is a PRODUCT photo, identify the product and help with their query (price, availability, ordering) using only the grounded product facts provided. If the image is a payment receipt, money-transfer confirmation, or a transaction screenshot (NOT a product), do NOT treat it as a product and do NOT confirm that any payment was received — respond according to the SHOP PAYMENT & DELIVERY rules above.'
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
        // Authoritative live config — must sit above FAQs/knowledge so the LLM
        // trusts the shop's CURRENT payment/delivery settings over any stale
        // seeded FAQ or persona example.
        operatingContext || '',
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
