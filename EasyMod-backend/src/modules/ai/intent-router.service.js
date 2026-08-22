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
const grounding = require('./grounding');
const { withEvidenceSnapshot } = require('./contracts/evidence.contract');
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

/**
 * A cached reply is replayed straight to a customer, so it must carry the
 * authoritative text that justified it — otherwise the outbound gate sees a
 * figure with no source and rejects a reply that was perfectly grounded when it
 * was generated. Stored as JSON; a legacy plain-string entry still reads fine.
 */
const encodeCacheEntry = (response, sourceText) =>
    JSON.stringify({ r: response, s: sourceText || '' });

const decodeCacheEntry = (raw) => {
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.r === 'string') return { response: parsed.r, sourceText: parsed.s || '' };
    } catch { /* legacy entry — plain response text */ }
    return { response: raw, sourceText: '' };
};

/** Evidence for a reply built entirely from one authoritative string. */
const evidenceFromSource = (shopId, sourceText) =>
    grounding.withSourceText(grounding.emptyEvidence(shopId), sourceText);

const buildOrderStatusHandoff = (shopId, language = 'mixed') => {
    const response = language === 'en'
        ? "I can't look that order up here. Our team will check it for you."
        : 'এই অর্ডারটি এখানে যাচাই করতে পারছি না। আমাদের টিম আপনার জন্য দেখে দেবে।';
    return {
        response,
        confidence: 1.0,
        source: 'order_status_handoff',
        sourceReferences: null,
        humanRequired: true,
        grounding: evidenceFromSource(shopId, response),
    };
};

/**
 * A reply may only be cached when it carries no product facts. Prices and stock
 * change; a hallucination that slips through must not be served for 30 minutes;
 * and a NOT_FOUND answer must be re-derived once the merchant adds the product.
 */
const isCacheable = (evidence) =>
    evidence.productStatus === grounding.ProductEvidenceStatus.NONE;

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

    // ------------------------------------------------------------------
    // Stage 1.5: Exact-match order lookup (DB query, zero LLM cost)
    // Handles "where is my order 12345?" style queries — the most common
    // BD f-commerce message type. This branch runs before the router-disabled
    // escape hatch so an order number can never reach the LLM unbound.
    // ------------------------------------------------------------------
    const orderMatch = !imageUrls.length ? message.match(/\b(\d{5,8})\b/) : null;
    if (orderMatch) {
        try {
            const { Conversation, Order } = require('../entities');
            if (!conversationId || typeof Conversation?.findOne !== 'function') {
                return buildOrderStatusHandoff(shopId, language);
            }

            const conversation = await Conversation.findOne({
                where: { id: conversationId, shop_id: shopId },
                attributes: ['customer_id'],
            });
            const customerId = conversation?.customer_id;
            if (!customerId) return buildOrderStatusHandoff(shopId, language);

            const order = await Order.findOne({
                where: {
                    shop_id: shopId,
                    order_number: orderMatch[1],
                    customer_id: customerId,
                },
                attributes: ['order_number', 'order_status', 'payment_status', 'delivery_status', 'delivery_tracking_code'],
            });
            if (!order) return buildOrderStatusHandoff(shopId, language);

            const statusLine = [
                `Order #${order.order_number}`,
                `Status: ${order.order_status || 'processing'}`,
                order.payment_status ? `Payment: ${order.payment_status}` : null,
                order.delivery_status ? `Delivery: ${order.delivery_status}` : null,
                order.delivery_tracking_code ? `Tracking: ${order.delivery_tracking_code}` : null,
            ].filter(Boolean).join(' | ');
            return {
                response: statusLine,
                confidence: 1.0,
                source: 'exact_match',
                grounding: evidenceFromSource(shopId, statusLine),
            };
        } catch (_) {
            return buildOrderStatusHandoff(shopId, language);
        }
    }

    if (ROUTER_DISABLED) {
        return _callLlm({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, imageUrls });
    }

    // ------------------------------------------------------------------
    // Stage 1: Exact-match response cache (skip for image and order messages)
    // ------------------------------------------------------------------
    const cacheKey = imageUrls.length > 0 ? null : normalisedKey(shopId, message);
    if (cacheKey) {
        const cached = decodeCacheEntry(await intentCache.get(cacheKey));
        if (cached) {
            return {
                response: cached.response,
                confidence: 1.0,
                source: 'cache',
                grounding: evidenceFromSource(shopId, cached.sourceText),
            };
        }
    }

    // ------------------------------------------------------------------
    // Stage 1.7: Regex greeting fast-path (runs before BERT so it works
    // even when the local ML service is down or low-confidence).
    // Only fires on short messages that are PURELY greeting tokens.
    // ------------------------------------------------------------------
    if (!imageUrls.length && isPlainGreeting(message)) {
        const greetingResponse = _greetingReply(language);
        if (cacheKey) await intentCache.setex(cacheKey, CACHE_TTL, encodeCacheEntry(greetingResponse, ''));
        return {
            response: greetingResponse,
            confidence: 0.95,
            source: 'greeting_fastpath',
            grounding: grounding.emptyEvidence(shopId),
        };
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
                if (cacheKey) await intentCache.setex(cacheKey, CACHE_TTL, encodeCacheEntry(greetingResponse, ''));
                return {
                    response: greetingResponse,
                    confidence: 0.9,
                    source: 'bert',
                    grounding: grounding.emptyEvidence(shopId),
                };
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

                    // The FAQ text is this reply's authoritative source: figures it
                    // contains (delivery charge, return window) are quotable, and
                    // nothing else is.
                    const faqEvidence = evidenceFromSource(shopId, faqContent);
                    faqEvidence.knowledgeIds = [String(best.faq.id)];
                    faqEvidence.knowledgeFound = true;

                    if (cacheKey) await intentCache.setex(cacheKey, CACHE_TTL, encodeCacheEntry(answer, faqContent));
                    return {
                        response: answer,
                        confidence: best.score,
                        source: 'faq',
                        provider,
                        grounding: faqEvidence,
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

/**
 * Retrieve shop-scoped product candidates for a query.
 *
 * Returns `failed: true` rather than an empty list when the DB errors: an
 * outage must become RETRIEVAL_FAILED (we do not know) and never NOT_FOUND
 * (we know the shop does not sell it). Collapsing the two is fail-open.
 */
const _findProductCandidates = async (params) => {
    try {
        const products = await productSearch.searchByAttributes(params);
        return { products: Array.isArray(products) ? products.filter(p => p && p.name) : [], failed: false };
    } catch (err) {
        console.warn(`[intent-router] product retrieval failed for shop ${params.shopId}: ${err.message}`);
        return { products: [], failed: true };
    }
};

/**
 * Knowledge-base retrieval. Returns the quotable snippets, their references and
 * any product IDs the vector store matched (which are candidates, never facts).
 */
const _retrieveKnowledge = async (shopId, message) => {
    const empty = { snippets: '', references: [], productIds: [], knowledgeIds: [] };
    try {
        const { queryData } = require('../rag/rag.service');
        const ragResult = await queryData({ query: message, limit: 4, shopId });
        if (!ragResult.success || !ragResult.results.length) return empty;

        const usedResults = ragResult.results.filter(r => r.score > 0.5);

        // Product embeddings deliberately EXCLUDE price and stock (they change too
        // often), so the stored product text must never be quoted as ground truth.
        // Vector product hits are re-fetched live below. On the local n-gram hash
        // fallback the embedder is not semantic at all and this tier measured a
        // 60–80% false-positive rate on products the shop does not sell
        // (docs/ai-cost/RETRIEVAL_QUALITY_EVALUATION.md), so it is skipped entirely.
        const semanticEmbeddings = embeddingSemantic();
        const productIds = [];
        const knowledgeResults = [];
        for (const r of usedResults) {
            const md = r.metadata || {};
            if (md.type === 'product' && md.product_id) {
                if (semanticEmbeddings) productIds.push(String(md.product_id));
            } else if (md.type !== 'business_info' && r.content) {
                knowledgeResults.push(r);
            }
        }

        return {
            snippets: knowledgeResults.map(r => r.content.trim()).join('\n---\n'),
            references: knowledgeResults.map(r => {
                const md = r.metadata || {};
                return {
                    kind: 'rag',
                    id: md.documentId || md.id || null,
                    title: md.title || md.source || md.kind || null,
                    score: typeof r.score === 'number' ? Number(r.score.toFixed(3)) : null,
                };
            }),
            productIds,
            knowledgeIds: knowledgeResults
                .map(r => (r.metadata || {}).documentId || (r.metadata || {}).id)
                .filter(Boolean)
                .map(String),
        };
    } catch (err) {
        // Knowledge is additive context. Its absence weakens the answer but does
        // not license a merchant claim — product truth is decided independently.
        console.warn(`[intent-router] knowledge retrieval unavailable: ${err.message}`);
        return empty;
    }
};

/**
 * Re-fetch the products this conversation already grounded, LIVE and under this
 * shop's scope. Re-reading matters: the IDs come from an earlier turn, and price
 * or stock may have moved since. Scoping matters more — it is what makes a
 * conversation carried across shops (or a tampered reference) impossible.
 */
const _loadContextProducts = async (shopId, history) => {
    const ids = grounding.contextProductIds(history);
    if (!ids.length) return { products: [], failed: false };
    try {
        const products = await productSearch.getProductsByIds(ids, shopId);
        return { products: (products || []).filter(p => p && p.name), failed: false };
    } catch (err) {
        console.warn(`[intent-router] context product lookup failed for shop ${shopId}: ${err.message}`);
        return { products: [], failed: true };
    }
};

/** Merge live rows for vector-store product hits into the candidate set. */
const _mergeVectorProductCandidates = async (candidates, productIds, shopId) => {
    const seen = new Set(candidates.map(p => String(p.id)));
    const missing = productIds.filter(id => !seen.has(id));
    if (!missing.length) return candidates;

    const live = await productSearch.getProductsByIds(missing, shopId).catch(() => []);
    return [...candidates, ...live.filter(p => p && p.name)];
};

const _callLlm = async ({ shopId, message, history, conversationId, language, systemPrompt, preferredProvider, cacheKey, imageUrls = [] }) => {
    const recentTurns = history.slice(-CONTEXT_WINDOW);

    const llmMessages = [];
    // Accumulates RAG / product sources that ground this reply. Surfaced back
    // to the worker so agents reviewing the AI message in the inbox can see
    // which knowledge drove the answer (architect §16).
    const sourceReferences = [];

    for (const turn of recentTurns) {
        llmMessages.push({
            role: turn.role === 'user' || turn.role === 'customer' ? 'user' : 'assistant',
            content: turn.content || turn.message || ''
        });
    }

    let groundedSystemPrompt = systemPrompt;
    const notes = [];

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
    let attrs = null;
    let searchOutcome = { products: [], failed: false };
    let knowledge = { snippets: '', references: [], productIds: [], knowledgeIds: [] };
    let groundingQuery = message;
    let attributeFollowUp = false;

    if (imageUrls.length > 0) {
        // Only the first photo is examined. A burst of photos is one shopping
        // question, not N of them (burst-coalescer gathers one URL per message),
        // and every extra image is another flat ~1,075-token charge for an
        // answer the customer did not ask for.
        const [primaryImageUrl] = imageUrls;

        attrs = photoMatchEnabled()
            ? await _extractProductAttributes(primaryImageUrl, message)
            : null;

        // The customer's own words ("ei kurti ta ache?" alongside the photo) are
        // a usable query in their own right, and the only one left if extraction
        // is off or failed. '[image]' is the webhook's placeholder for a photo
        // with no caption; it is not a search term.
        const captionText = (message && message !== '[image]') ? message : '';

        // Attributes read off the photo are the identifying terms for a photo
        // turn — the customer supplied a picture, not words.
        groundingQuery = [attrs?.category, attrs?.color, attrs?.material, captionText]
            .filter(Boolean).join(' ') || captionText;

        if (shopId && (attrs || (captionText && shouldSearchProducts(captionText)))) {
            searchOutcome = await _findProductCandidates({
                shopId,
                category: attrs?.category,
                color: attrs?.color,
                material: attrs?.material,
                query: attrs?.query || captionText,
                tags: attrs?.tags || [],
                limit: 5,
            });
        }

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
                `It describes the CUSTOMER'S picture, not a product this shop sells; only the ` +
                `catalog evidence below says what this shop actually has.`
            );
        }

        if (imageUrls.length > 1) {
            notes.push(
                `NOTE: The customer sent ${imageUrls.length} photos. Only the first was examined. ` +
                `If your answer depends on which one they meant, say you looked at the first ` +
                `photo and offer to check another.`
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

        // An attribute follow-up ("eta chiffon?") names no product — the noun is
        // in the previous turn — so it is resolved against the products this
        // conversation already grounded, not by searching the catalog again.
        attributeFollowUp = shopId && grounding.isAttributeOnlyQuery(message);

        // Product search and knowledge retrieval are independent reads — running
        // them together keeps the added grounding work off the critical path.
        [searchOutcome, knowledge] = await Promise.all([
            attributeFollowUp
                ? _loadContextProducts(shopId, history)
                : (shopId && shouldSearchProducts(message)
                    ? _findProductCandidates({ shopId, query: message, limit: 5 })
                    : Promise.resolve({ products: [], failed: false })),
            shopId ? _retrieveKnowledge(shopId, message) : Promise.resolve(knowledge),
        ]);
    }

    // -----------------------------------------------------------------------
    // Authoritative evidence for this turn. One resolution over the union of
    // every candidate source, so SQL search and vector search cannot disagree
    // about whether a product exists.
    // -----------------------------------------------------------------------
    const candidates = knowledge.productIds.length
        ? await _mergeVectorProductCandidates(searchOutcome.products, knowledge.productIds, shopId)
        : searchOutcome.products;

    const evidence = attributeFollowUp
        ? grounding.resolveContextualAttributeEvidence({
            shopId,
            message,
            contextProducts: candidates,
            retrievalFailed: searchOutcome.failed,
        })
        : grounding.resolveProductEvidence({
            shopId,
            message: groundingQuery,
            candidates,
            retrievalFailed: searchOutcome.failed,
        });
    evidence.knowledgeIds = knowledge.knowledgeIds;
    evidence.knowledgeFound = Boolean(knowledge.snippets);
    Object.assign(evidence, withEvidenceSnapshot(evidence));

    for (const product of [...evidence.verifiedProducts, ...evidence.relatedProducts]) {
        sourceReferences.push({ kind: 'product', id: product.id, title: product.name });
    }
    sourceReferences.push(...knowledge.references);

    // -----------------------------------------------------------------------
    // Deterministic short-circuit. When the catalog answers the question, the
    // model has nothing to add and every reason to embellish: a NOT_FOUND turn
    // is answered from written copy, with real alternatives when we have them.
    // This is what makes "chiffon saree ache?" safe by construction rather than
    // by instruction — and it costs zero tokens.
    // -----------------------------------------------------------------------
    // "delivery charge koto?" leaves identifying terms behind ("charge") that no
    // product matches, but it is a policy question, not a product-existence one.
    // Answering it with "we don't sell that" would be a different — and wrong —
    // claim, so the written not-found reply is reserved for turns that really are
    // asking whether a product exists.
    // Photo turns are excluded: the customer sent a picture and deserves a reply
    // that acknowledges it. The NOT_FOUND evidence block already forbids claiming
    // the item exists, and the outbound gate still polices prices and URLs.
    const productQuestion = !imageUrls.length && !knowledge.snippets && (
        evidence.relatedProducts.length > 0
        || hasProductIntent(groundingQuery)
        || grounding.isMediaRequest(message)
    );

    const deterministic = _deterministicProductReply(evidence, language, {
        attributeFollowUp,
        productQuestion,
    });
    if (deterministic) {
        return {
            response: deterministic.response,
            confidence: deterministic.confidence,
            source: deterministic.source,
            grounding: evidence,
            sourceReferences: sourceReferences.length ? sourceReferences : null,
        };
    }

    const evidenceBlock = grounding.renderEvidenceBlock(evidence);
    if (evidenceBlock) {
        notes.push(evidenceBlock);
        grounding.withSourceText(evidence, evidenceBlock);
    }

    if (knowledge.snippets) {
        notes.push(
            `KNOWLEDGE BASE CONTEXT (the shop's own answers about delivery, policies and services):\n${knowledge.snippets}\n\n` +
            `IMPORTANT: Only use the knowledge above. If the answer is not in it, say you do not have that ` +
            `information and offer to check with the shop — never invent a shop policy, charge or timeline.`
        );
        grounding.withSourceText(evidence, knowledge.snippets);
    }

    groundedSystemPrompt = [systemPrompt, ...notes].filter(Boolean).join('\n\n');

    // The shop's own configured facts (payment methods, delivery charges) are
    // already inside systemPrompt via shop-operating-context; record them so the
    // outbound gate recognises the figures they contain as sourced.
    grounding.withSourceText(evidence, systemPrompt);

    // Links the merchant configured (shop page, socials) are authoritative and may
    // be shared — but never as a stand-in for a product photo. Once a photo has
    // been asked for, the media rules own every URL in the reply, which is what
    // stops "here's our Facebook Page" from answering "send the real picture".
    if (evidence.mediaStatus === grounding.MediaStatus.NOT_REQUESTED) {
        evidence.allowedUrls.push(
            ...grounding.extractUrls(systemPrompt),
            ...grounding.extractUrls(knowledge.snippets),
        );
    }

    // Product retrieval adds knowledge and prompt source text after the pure
    // evidence resolver returns. Re-hash the complete snapshot before generation
    // so Action Gate and the outbound verifier see exactly the same evidence.
    Object.assign(evidence, withEvidenceSnapshot(evidence));

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

    if (cacheKey && isCacheable(evidence)) {
        await intentCache.setex(cacheKey, CACHE_TTL, encodeCacheEntry(response, evidence.sourceText));
    }

    return {
        response,
        confidence: 0.9,
        source: 'llm',
        provider,
        grounding: evidence,
        sourceReferences: sourceReferences.length ? sourceReferences : null,
    };
};

/**
 * The written reply for turns whose answer is already settled by the catalog.
 * Returns null when the model still has useful work to do.
 *
 * NOT_FOUND and RETRIEVAL_FAILED are answered here because both are cases where
 * generation can only make the answer worse — and because a customer applying
 * pressure ("are you sure?", "abar check koren") re-enters this same code path
 * and gets the same answer, which is exactly the property the incident lacked.
 */
const _deterministicProductReply = (evidence, language, { attributeFollowUp = false, productQuestion = true } = {}) => {
    const { ProductEvidenceStatus, MediaStatus } = grounding;

    if (attributeFollowUp && evidence.productStatus === ProductEvidenceStatus.NONE) {
        // They asked about a fabric/colour but nothing in this conversation is
        // grounded to a product. Asking which one is the only honest answer —
        // and it is what stops an earlier hallucinated "chiffon saree" from
        // being treated as the product under discussion.
        return {
            response: grounding.whichProductReply(language),
            confidence: 1.0,
            source: 'grounding_needs_product',
        };
    }

    if (evidence.productStatus === ProductEvidenceStatus.RETRIEVAL_FAILED) {
        return {
            response: grounding.retrievalFailedReply(language),
            // Zero confidence routes this through the existing low-confidence
            // gate: the reply is held and a human is pulled in, rather than the
            // customer being left with a non-answer.
            confidence: 0,
            source: 'grounding_retrieval_failed',
        };
    }

    if (evidence.productStatus === ProductEvidenceStatus.NOT_FOUND && productQuestion) {
        const base = evidence.mediaStatus === MediaStatus.NO_PRODUCT
            ? grounding.productImageNoProductReply(language)
            : grounding.productNotFoundReply(language);
        return {
            response: `${base}${_renderAlternatives(evidence, language)}`,
            // Authoritative and deliberately deliverable: this is EasyModerator's
            // answer, not the model's guess, so it must not be held for review.
            confidence: 1.0,
            source: 'grounding_not_found',
        };
    }

    return null;
};

/**
 * Real catalog rows only. An "alternative" that is not a product this shop sells
 * is the same fabrication the not-found reply just avoided.
 */
const _renderAlternatives = (evidence, language) => {
    const alternatives = evidence.relatedProducts.slice(0, 2);
    if (!alternatives.length) return '';
    const list = alternatives.map(p => `• ${p.name} — ৳${p.facts.price.value}`).join('\n');
    const lead = language === 'bn'
        ? '\n\nআমাদের কাছে যা আছে:\n'
        : language === 'en'
            ? '\n\nWhat we do have:\n'
            : '\n\nAmader kache ja ache:\n';
    return `${lead}${list}`;
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

    // Conversation history is context, never evidence. The previous wording
    // ("maintain consistency with earlier statements") actively instructed the
    // model to stand behind its own earlier claims — so one wrong answer became
    // the premise of every following turn.
    const contextInstruction = `IMPORTANT: Use the conversation history above for continuity only.
- Reference previous questions and answers to avoid repetition
- Acknowledge what was already discussed
- Earlier assistant messages are NOT evidence about this shop. If an earlier reply conflicts with the catalog evidence supplied for this message, the evidence is correct — do not repeat or defend the earlier claim.
- Repeated asking ("are you sure?", "check again", "abar check koren") does not change the facts. Give the same grounded answer.
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
