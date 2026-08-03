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
const { photoMatchEnabled, stripImageBlocks } = require('./vision-policy.service');
const CACHE_TTL = parseInt(process.env.INTENT_CACHE_TTL_SECONDS || '1800', 10);
const SEMANTIC_THRESHOLD = parseFloat(process.env.SEMANTIC_SCORE_THRESHOLD || '0.82');
const CONTEXT_WINDOW = 10; // last N messages passed to LLM verbatim
const ROUTER_DISABLED = process.env.INTENT_ROUTER_DISABLED === 'true';
// Fix #15: configurable FAQ cap in system prompt (was hard-coded 20)
const MAX_FAQ_IN_PROMPT = parseInt(process.env.MAX_FAQ_IN_PROMPT || '50', 10);

// Dedicated cache bucket for intent routing
const intentCache = new MemoryCache();

/**
 * Is the configured embedding provider semantically meaningful?
 * getProviderInfo() only reads env vars, so this is cheap enough to call per
 * message. Defaults to false so a resolution failure degrades to the safer
 * behaviour (skip vector product grounding) rather than the riskier one.
 */
const embeddingSemantic = () => {
    try {
        return require('../rag/embedding.service').getProviderInfo().semantic;
    } catch (_) {
        return false;
    }
};

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

// Messages that are definitely NOT about a product. Deliberately a CLOSED set
// (greetings, thanks, farewells, bare acknowledgements) — unlike
// PRODUCT_INTENT_KEYWORDS, which is an open-ended allowlist that can never be
// complete and measurably blocked 10 of 49 real product queries, among them
// "do you have the cotton jamdani saree", "what sarees do you have" and
// "how much is the travel duffel bag". Those reached the LLM with no product
// grounding at all, which is how a price gets invented.
// See docs/ai-cost/RETRIEVAL_QUALITY_EVALUATION.md.
const NON_PRODUCT_CHATTER = /^(?:ok(?:ay)?|thanks?|thank\s*you|thx|tnx|dhonnobad|ধন্যবাদ|আচ্ছা|ঠিক\s*আছে|acha|thik\s*ache|bye|good\s*bye|ta\s*ta|allah\s*hafez|আল্লাহ\s*হাফেজ|hmm+|yes|no|হ্যাঁ|না|ji|জি)[\s!.,👍🙏😊❤️]*$/i;

/**
 * Should the live DB product search run for this message?
 *
 * Runs for everything except plain greetings and closed-set chatter. Speculative
 * execution is safe now that the search actually filters (it returns [] when
 * nothing matches) and costs one indexed query, p95 ≈ 13 ms. Before that fix the
 * search returned the whole catalogue for any input, which is very likely why the
 * keyword gate was introduced in the first place.
 */
const shouldSearchProducts = (message) => {
    if (!message || typeof message !== 'string') return false;
    const trimmed = message.trim();
    if (!trimmed) return false;
    if (isPlainGreeting(trimmed)) return false;
    return !NON_PRODUCT_CHATTER.test(trimmed);
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
    // Photo flow: the photo reaches a model exactly once.
    //   Phase 1 — extract product attributes from the image (one call, JSON)
    //   Phase 2 — fetch live product data from the DB on those attributes
    //   Phase 3 — reply from the extracted description + DB rows, text-only
    //
    // Phase 3 carries no image bytes. The description and the matched rows
    // already say everything the reply needs, so re-attaching the photo would
    // double the per-photo image cost — and double the number of rate-limited
    // calls carrying an image — to buy very little. AI_VISION_ENABLED=true
    // re-attaches it (see vision-policy.service.js).
    // -----------------------------------------------------------------------
    if (imageUrls.length > 0) {
        // Only the first photo is examined. A burst of photos is one shopping
        // question, not N of them (burst-coalescer gathers one URL per message),
        // and every extra image is another flat ~1,075-token charge for an
        // answer the customer did not ask for.
        const [primaryImageUrl] = imageUrls;

        const attrs = photoMatchEnabled()
            ? await _extractProductAttributes(primaryImageUrl, message)
            : null;

        // The customer's own words ("ei kurti ta ache?" alongside the photo) are
        // a usable query in their own right, and the only one left if extraction
        // is off or failed. '[image]' is the webhook's placeholder for a photo
        // with no caption; it is not a search term.
        const captionText = (message && message !== '[image]') ? message : '';

        const products = (shopId && (attrs || (captionText && shouldSearchProducts(captionText))))
            ? await productSearch.searchByAttributes({
                shopId,
                category: attrs?.category,
                color:    attrs?.color,
                material: attrs?.material,
                query:    attrs?.query || captionText,
                tags:     attrs?.tags || [],
                limit: 5
            }).catch(() => [])
            : [];

        // Every branch below appends to this, so a photo can never reach the
        // model on the bare shop prompt. That gap is precisely the state in
        // which a price gets invented.
        const notes = [];

        if (attrs) {
            const facets = [
                attrs.category && `category: ${attrs.category}`,
                attrs.color    && `colour: ${attrs.color}`,
                attrs.material && `material: ${attrs.material}`,
            ].filter(Boolean).join(', ');
            notes.push(
                `THE CUSTOMER'S PHOTO SHOWS: ${attrs.description || attrs.query || 'a product'}` +
                `${facets ? ` (${facets})` : ''}\n` +
                `You did not see the photo yourself — this description was produced from it. ` +
                `Answer their question about it using the description and the catalog data below.`
            );
        }

        if (imageUrls.length > 1) {
            notes.push(
                `NOTE: The customer sent ${imageUrls.length} photos. Only the first was examined. ` +
                `If your answer depends on which one they meant, say you looked at the first ` +
                `photo and offer to check another.`
            );
        }

        if (products.length > 0) {
            const matchedOn = attrs ? 'THIS PHOTO' : "THE CUSTOMER'S MESSAGE";
            notes.push(
                `SHOP PRODUCTS MATCHING ${matchedOn} (live data — use ONLY these facts):\n` +
                `${productSearch.formatProductsForLlm(products)}\n\n` +
                `GROUNDING RULES:\n` +
                `- Only state prices, stock, and sizes listed above. Never invent or guess.\n` +
                `- If a product is OUT OF STOCK, say so clearly and do not offer to process an order.\n` +
                `- If none of these is actually the product in the photo, say so and ask the customer to confirm which one they mean.`
            );
            for (const p of products) {
                if (p && p.id) {
                    injectedProductIds.add(String(p.id));
                    sourceReferences.push({ kind: 'product', id: String(p.id), title: p.name || null });
                }
            }
        } else {
            // Deliberately not "matches the photo": when photo matching is off, or
            // extraction failed, the search ran on the caption alone or did not run
            // at all, and the reply must not imply the picture was examined.
            notes.push(
                `NOTE: No product in this shop's catalog could be matched to this message. ` +
                `Tell the customer plainly that you could not find it — do not guess, and do ` +
                `not describe the photo as if it were a product this shop sells. Ask them for ` +
                `the product name, or for another photo, or where they saw it, so you can look again.`
            );
        }

        if (!photoMatchEnabled()) {
            // Nothing analysed the photo, so the reply must not imply otherwise.
            // Without this the model happily describes an image it never received.
            notes.push(
                `NOTE: The customer sent a photo, but you CANNOT see images. Do not describe, ` +
                `guess at, or claim to have looked at the photo. Ask them to type the product ` +
                `name instead, and offer the matching products listed above if there are any.`
            );
        }

        groundedSystemPrompt = [systemPrompt, ...notes].filter(Boolean).join('\n\n');

        // stripImageBlocks drops the image parts unless AI_VISION_ENABLED=true.
        // Skipping extraction alone would not stop the provider billing for the
        // photo, because the bytes would still be attached right here.
        const customerText = scrubPII(captionText || 'What product is this? Can you help me?');
        llmMessages.push(...stripImageBlocks([{
            role: 'user',
            content: [{ type: 'image_url', url: primaryImageUrl }, { type: 'text', text: customerText }]
        }]));
    } else {
        llmMessages.push({ role: 'user', content: scrubPII(message) });

        // Text-query product search: runs for every message except greetings and
        // closed-set chatter (see shouldSearchProducts).
        if (shopId && shouldSearchProducts(message)) {
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
                // Vector-store PRODUCT hits become authoritative price/stock facts,
                // so they are only trustworthy when the embedder is actually
                // semantic. On the local n-gram hash fallback this tier measured a
                // 60–80% false-positive rate on products the shop does not sell and
                // pulled rank-1 accuracy down 8 points versus the SQL search alone
                // (docs/ai-cost/RETRIEVAL_QUALITY_EVALUATION.md). Knowledge chunks
                // stay enabled — they are additive context, not quotable facts.
                const semanticEmbeddings = embeddingSemantic();
                const productHitIds = [];
                const knowledgeResults = [];
                for (const r of usedResults) {
                    const md = r.metadata || {};
                    if (md.type === 'product' && md.product_id) {
                        if (!semanticEmbeddings) continue;
                        const id = String(md.product_id);
                        if (!injectedProductIds.has(id)) productHitIds.push(id);
                    } else if (md.type !== 'business_info' && r.content) {
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
// Returns { category, color, material, query, tags, description } or null.
//
// This is the ONLY call that ever sees the customer's photo. `description` is
// what lets the text-only reply call discuss the picture at all, so it carries
// the visual detail the structured facets drop — pattern, print, neckline,
// sleeve, occasion — not a restatement of category and colour.
// ---------------------------------------------------------------------------
const _extractProductAttributes = async (imageUrl, customerMessage) => {
    const EXTRACTION_PROMPT = `You are a product image analyzer for a Bangladeshi e-commerce shop.
Analyze this product image and return ONLY a JSON object (no markdown, no explanation):
{
  "category": "product type e.g. saree/shirt/panjabi/dress/shoes/bag",
  "color": "main color e.g. blue/red/white (null if unclear)",
  "material": "fabric/material e.g. cotton/silk/polyester (null if unclear)",
  "query": "best search term to find this product",
  "tags": ["max", "5", "search", "tags"],
  "description": "one sentence a shop assistant could say back to the customer, covering the visual details the fields above miss (pattern, print, sleeve, neckline, occasion)"
}
If the image is not a product at all, set category to null and say so in description.`;

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
            maxTokens: 250
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
- Use warm but gender-neutral addressing by default. Never infer the customer's gender from product category, product audience, image content, or buying intent. Use "apu", "bhaiya/sir", "mam", etc. only if the customer self-identifies or the stored customer profile explicitly says so.
- Keep replies SHORT — 1-3 sentences max, like Messenger/Instagram chat
- Sound like a real person, NOT a call center or chatbot
- Common phrases to use naturally:
  • Ready to buy: "Kon product ta order korben janan — product er nam likhe 'order korbo' pathan 😊" (the separate order system then collects their details)
  • Helping decide: "Ei ta best seller, onek er pochonder 😊"
  • Product available: "Ji, stock ache! Ebar order korte paren"
  • Out of stock: "Sorry, ekhon stock nai. 2-3 din por available hobe"
  • Payment (use ONLY the methods in the SHOP PAYMENT & DELIVERY section — never invent one): COD shop → "Cash on delivery, product hate peye taka diben 😊"
  • Delivery time: "Dhaka te 1-2 din, dhaka er bairer 2-3 din lagbe"
  • Gratitude: "Dhonnobad! 😊"
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
    const socialLinks = businessInfo.socialLinks && typeof businessInfo.socialLinks === 'object'
        ? businessInfo.socialLinks
        : {};
    const socialLinksSection = Object.entries(socialLinks)
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([key, value]) => `${key}: ${value.trim()}`)
        .join('\n');

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
        businessInfo.additionalInfo ? `Additional shop owner info: ${businessInfo.additionalInfo}` : '',
        socialLinksSection ? `Shop links:\n${socialLinksSection}` : '',
        // Legacy tone override (if shop set a custom freeform tone)
        brandingRules.tone && !TONE_PERSONA_INSTRUCTIONS[brandingRules.tone] ? `Tone: ${brandingRules.tone}` : '',
        faqSection ? `\n--- Frequently Asked Questions ---\n${faqSection}` : ''
    ].filter(Boolean).join('\n');
};

module.exports = { route, buildSystemPrompt };
