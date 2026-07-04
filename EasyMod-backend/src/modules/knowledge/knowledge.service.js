const { Shop, UserShop, FaqResponse, BanglishDictionary } = require('../entities');
const shopService = require('../shop/shop.service');
const KnowledgeGap = require('../analytics/knowledge-gap.entity');
const { AppError } = require('../../utils/AppError');
const ragService = require('../rag/rag.service');
const cacheService = require('../../utils/cache.service');
const crypto = require('crypto');
const { Op, fn, col, literal } = require('sequelize');

const KNOWLEDGE_CACHE_KEY = 'knowledge:summary';
const KNOWLEDGE_CACHE_TTL = 300; // 5 minutes
const MAX_DOC_SIZE = 100 * 1024; // 100 KB

// ── Auth helpers ──────────────────────────────────────────────────────────────

const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: { user_id: userId, shop_id: shopId, is_active: true }
    });
    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Map a FaqResponse Sequelize instance to the shape the frontend expects.
 * Frontend types: { id, question, answer, category, confidence, source,
 *                   active, usageCount, createdAt, updatedAt }
 */
const formatFaq = (faq) => ({
    id: String(faq.id),
    question: faq.category,
    answer: faq.template_en || faq.template_bn || '',
    category: faq.category,
    template_bn: faq.template_bn,
    template_en: faq.template_en,
    confidence: 1.0, // manually-authored FAQs are always highest confidence
    source: 'manual',
    active: faq.is_active,
    usageCount: faq.use_count || 0,
    priority: faq.priority,
    createdAt: faq.created_at,
    updatedAt: faq.updated_at || faq.created_at,
});

const buildFaqIndexText = (faq) => [
    faq.category && `Q: ${faq.category}`,
    faq.template_bn && `A (BN): ${faq.template_bn}`,
    faq.template_en && `A (EN): ${faq.template_en}`,
].filter(Boolean).join('\n');

const syncFaqRagIndex = async (shopId, faq) => {
    if (!faq?.id) return;

    const documentId = `faq-${faq.id}`;
    if (faq.is_active === false) {
        await ragService.deletePoint(documentId, shopId).catch(() => {});
        return;
    }

    const text = buildFaqIndexText(faq);
    if (!text) return;

    await ragService.ingestData({
        text,
        metadata: {
            documentId,
            shopId,
            type: 'faq',
            faq_id: faq.id
        }
    }).catch(() => {});
};

// ── JSON helpers ──────────────────────────────────────────────────────────────

const normalizeArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return value.split(',').map(v => v.trim()).filter(Boolean);
        }
    }
    return [];
};

const normalizeObject = (value) => {
    if (!value) return {};
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
};

const getShop = async (shopId) => {
    const shop = await Shop.findByPk(shopId);
    if (!shop) throw new AppError('Shop not found', 404);
    return shop;
};

// ── Core knowledge read ───────────────────────────────────────────────────────

const getKnowledge = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const cached = await cacheService.getForShop(shopId, KNOWLEDGE_CACHE_KEY);
    if (cached) return cached;

    const [shop, faqs] = await Promise.all([
        getShop(shopId),
        FaqResponse.findAll({ where: { shop_id: shopId }, order: [['priority', 'DESC']] })
    ]);

    const settings = normalizeObject(shop.settings);

    // Fix #6: Do NOT expose the Facebook page access token to the frontend.
    // The token is for server-side API calls only.
    const businessInfo = normalizeObject(settings.businessInfo);

    const aiSettings = await shopService.getShopAiSettings(shopId).catch(() => ({}));

    const result = {
        businessInfo,
        brandingRules: normalizeObject(settings.brandingRules),
        faqs: faqs.map(formatFaq),
        documents: normalizeArray(settings.documents),
        ai_settings: aiSettings
    };

    await cacheService.setForShop(shopId, KNOWLEDGE_CACHE_KEY, result, KNOWLEDGE_CACHE_TTL).catch(() => {});
    return result;
};

// ── Business info ─────────────────────────────────────────────────────────────

const updateBusinessInfo = async (userId, shopId, data) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    const existing = normalizeObject(settings.businessInfo);

    // Merge incoming data onto existing values — never overwrite with empty strings on partial save
    const businessInfo = {
        shopName:       data.shopName       !== undefined ? String(data.shopName).trim()       : existing.shopName       || '',
        address:        data.address        !== undefined ? String(data.address).trim()        : existing.address        || '',
        phone:          data.phone          !== undefined ? String(data.phone).trim()          : existing.phone          || '',
        openingHours:   data.openingHours   !== undefined ? String(data.openingHours).trim()   : existing.openingHours   || '',
        deliveryAreas:  data.deliveryAreas  !== undefined ? normalizeArray(data.deliveryAreas)  : normalizeArray(existing.deliveryAreas),
        paymentMethods: data.paymentMethods !== undefined ? normalizeArray(data.paymentMethods) : normalizeArray(existing.paymentMethods),
        // Social links surfaced in the order-confirmation closing (ai-messaging.renderSocialLinks).
        socialLinks:    data.socialLinks    !== undefined ? normalizeObject(data.socialLinks)    : normalizeObject(existing.socialLinks),
    };

    const shopUpdates = { settings: { ...settings, businessInfo } };
    if (data.shopName && String(data.shopName).trim()) {
        shopUpdates.shop_name = data.shopName.trim();
        shopUpdates.name = data.shopName.trim();
    }

    await shop.update(shopUpdates);
    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    return { businessInfo };
};

// ── Branding rules ────────────────────────────────────────────────────────────

const updateBrandingRules = async (userId, shopId, brandingRules) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    await shop.update({ settings: { ...settings, brandingRules: brandingRules || {} } });
    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    return { brandingRules };
};

// ── FAQs ──────────────────────────────────────────────────────────────────────

const listFaqs = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const faqs = await FaqResponse.findAll({
        where: { shop_id: shopId },
        order: [['priority', 'DESC']]
    });
    return faqs.map(formatFaq);
};

const createFaq = async (userId, shopId, faq) => {
    await verifyShopAccess(userId, shopId);
    const newFaq = await FaqResponse.create({
        shop_id: shopId,
        category: faq.category || faq.question || 'General',
        template_bn: faq.template_bn || null,
        template_en: faq.template_en || faq.answer || null,
        variables: faq.variables || [],
        priority: faq.priority || 0,
        is_active: faq.is_active !== undefined ? faq.is_active : (faq.active !== undefined ? faq.active : true)
    });

    await syncFaqRagIndex(shopId, newFaq);
    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    return formatFaq(newFaq);
};

/**
 * Starter FAQ pack for a brand-new BD f-commerce shop. Seeded on demand during
 * onboarding so the AI can answer the most common buyer questions from day one
 * instead of cold-starting with an empty knowledge base (the #1 activation
 * killer). Answers are intentionally generic with a "(update for your shop)"
 * nudge — the seller edits them like any other FAQ.
 */
const STARTER_FAQS = Object.freeze([
    {
        category: 'ডেলিভারি চার্জ কত? / What is the delivery charge?',
        template_bn: 'ঢাকার ভিতরে ডেলিভারি চার্জ ৳60–৳80, ঢাকার বাইরে ৳120–৳150। (আপনার শপ অনুযায়ী আপডেট করুন)',
        template_en: 'Inside Dhaka delivery is ৳60–৳80, outside Dhaka ৳120–৳150. (Please update for your shop.)',
    },
    {
        category: 'ক্যাশ অন ডেলিভারি আছে? / Is cash on delivery available?',
        template_bn: 'হ্যাঁ, ক্যাশ অন ডেলিভারি (COD) available। পণ্য হাতে পেয়ে টাকা দিতে পারবেন।',
        template_en: 'Yes, Cash on Delivery (COD) is available — you pay when you receive the product.',
    },
    {
        // COD-only by default — do NOT seed bKash/Nagad here. The seller adds
        // those after connecting a payment method; advertising rails the shop
        // hasn't connected is a direct cause of the bot asking for advance
        // payment it can't accept. (Update for your shop once configured.)
        category: 'পেমেন্ট কিভাবে করব? / How can I pay?',
        template_bn: 'ক্যাশ অন ডেলিভারিতে পেমেন্ট করতে পারেন — পণ্য হাতে পেয়ে টাকা দিবেন। (আপনার শপ অনুযায়ী আপডেট করুন)',
        template_en: 'You can pay by Cash on Delivery — pay when you receive the product. (Please update for your shop.)',
    },
    {
        category: 'ডেলিভারিতে কত দিন লাগে? / How long does delivery take?',
        template_bn: 'ঢাকার ভিতরে ১–২ দিন, ঢাকার বাইরে ৩–৫ দিন লাগে।',
        template_en: 'Inside Dhaka 1–2 days, outside Dhaka 3–5 days.',
    },
    {
        category: 'রিটার্ন বা এক্সচেঞ্জ করা যাবে? / Can I return or exchange?',
        template_bn: 'পণ্যে সমস্যা থাকলে ডেলিভারির ৩ দিনের মধ্যে এক্সচেঞ্জ করা যাবে।',
        template_en: 'If there is an issue with the product, exchange is possible within 3 days of delivery.',
    },
    {
        category: 'কিভাবে অর্ডার করব? / How do I place an order?',
        template_bn: 'অর্ডার করতে আপনার নাম, ঠিকানা, ফোন নম্বর এবং পণ্যের নাম দিন।',
        template_en: 'To order, please share your name, address, phone number, and the product you want.',
    },
    {
        category: 'অর্ডার কনফার্ম কিভাবে হবে? / How is my order confirmed?',
        template_bn: 'অর্ডার দেওয়ার পর আমরা ফোন বা মেসেজে কনফার্ম করব।',
        template_en: 'After you order, we will confirm by phone or message.',
    },
]);

/**
 * Seed the starter FAQ pack for a shop. Idempotent and non-destructive: it only
 * seeds when the shop has ZERO FAQs, so it can never duplicate the pack or
 * clobber FAQs a seller has already written.
 * @returns {{ seeded: number, skipped: boolean, reason?: string, faqs?: object[] }}
 */
const seedStarterFaqs = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const existing = await FaqResponse.count({ where: { shop_id: shopId } });
    if (existing > 0) {
        return { seeded: 0, skipped: true, reason: 'faqs_already_exist' };
    }

    const rows = await FaqResponse.bulkCreate(
        STARTER_FAQS.map((f, i) => ({
            shop_id: shopId,
            category: f.category,
            template_bn: f.template_bn,
            template_en: f.template_en,
            variables: ['starter'],
            priority: STARTER_FAQS.length - i, // preserve listed order (higher = first)
            is_active: true,
        }))
    );

    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    return { seeded: rows.length, skipped: false, faqs: rows.map(formatFaq) };
};

const updateFaq = async (userId, shopId, faqId, updates) => {
    await verifyShopAccess(userId, shopId);
    const faq = await FaqResponse.findOne({ where: { id: faqId, shop_id: shopId } });
    if (!faq) throw new AppError('FAQ not found', 404);

    const nextValues = {
        category: updates.category || updates.question || faq.category,
        template_bn: updates.template_bn !== undefined ? updates.template_bn : faq.template_bn,
        template_en: updates.template_en !== undefined
            ? updates.template_en
            : (updates.answer !== undefined ? updates.answer : faq.template_en),
        variables: updates.variables || faq.variables,
        priority: updates.priority !== undefined ? updates.priority : faq.priority,
        is_active: updates.is_active !== undefined
            ? updates.is_active
            : (updates.active !== undefined ? updates.active : faq.is_active)
    };

    await faq.update(nextValues);
    const indexedFaq = typeof faq.get === 'function' ? faq.get({ plain: true }) : { ...faq };
    Object.assign(indexedFaq, nextValues);

    await syncFaqRagIndex(shopId, indexedFaq);
    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    return formatFaq(indexedFaq);
};

const deleteFaq = async (userId, shopId, faqId) => {
    await verifyShopAccess(userId, shopId);
    await FaqResponse.destroy({ where: { id: faqId, shop_id: shopId } });
    await ragService.deletePoint(`faq-${faqId}`, shopId).catch(() => {});
    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});
    return { message: 'FAQ deleted successfully' };
};

// ── Knowledge Gaps ────────────────────────────────────────────────────────────

/**
 * Fix #10: Read gaps from the KnowledgeGap DB table (written by n8n),
 * aggregated by question to compute frequency + date range.
 */
const listGaps = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const rows = await KnowledgeGap.findAll({
        where: { shop_id: shopId },
        order: [['created_at', 'DESC']],
        limit: 200
    });

    // Aggregate: group by normalised question text
    const gapMap = new Map();
    for (const row of rows) {
        const key = row.question.trim().toLowerCase();
        if (!gapMap.has(key)) {
            gapMap.set(key, {
                id: String(row.id),
                question: row.question,
                frequency: 0,
                platform: row.platform,
                language: row.language,
                firstAsked: row.created_at,
                lastAsked: row.created_at
            });
        }
        const g = gapMap.get(key);
        g.frequency++;
        if (new Date(row.created_at) < new Date(g.firstAsked)) g.firstAsked = row.created_at;
        if (new Date(row.created_at) > new Date(g.lastAsked))  g.lastAsked  = row.created_at;
    }

    return Array.from(gapMap.values()).sort((a, b) => b.frequency - a.frequency);
};

// ── Documents ─────────────────────────────────────────────────────────────────

const listDocuments = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);
    const settings = normalizeObject(shop.settings);
    return normalizeArray(settings.documents);
};

const createDocument = async (userId, shopId, document) => {
    await verifyShopAccess(userId, shopId);

    // Fix #12: Limit document text size to 100 KB
    if (document?.text && document.text.length > MAX_DOC_SIZE) {
        throw new AppError(
            `Document text too large (${Math.round(document.text.length / 1024)} KB). Maximum is 100 KB.`,
            400
        );
    }

    const shop = await getShop(shopId);
    const settings = normalizeObject(shop.settings);
    const documents = normalizeArray(settings.documents);

    const newDocument = {
        id: crypto.randomUUID(),
        name: document.name,
        contentType: document.contentType,
        size: document.size,
        source: document.source,
        tags: document.tags || [],
        createdAt: new Date().toISOString(),
        status: document?.text ? 'processing' : 'indexed'
    };

    documents.push(newDocument);
    await shop.update({ settings: { ...settings, documents } });

    // Fix #8: Non-blocking RAG ingestion — update status in background
    if (document?.text) {
        ragService.ingestData({
            text: document.text,
            metadata: {
                documentId: newDocument.id,
                shopId,
                name: document.name,
                contentType: document.contentType,
                source: document.source,
                tags: document.tags || []
            }
        }).then(async () => {
            // Update status to indexed
            const s = await Shop.findByPk(shopId);
            if (!s) return;
            const st = normalizeObject(s.settings);
            const docs = normalizeArray(st.documents).map(d =>
                d.id === newDocument.id ? { ...d, status: 'indexed' } : d
            );
            await s.update({ settings: { ...st, documents: docs } });
        }).catch(async (err) => {
            console.warn(`RAG ingest (doc-${newDocument.id}) failed:`, err.message);
            // Update status to failed
            const s = await Shop.findByPk(shopId);
            if (!s) return;
            const st = normalizeObject(s.settings);
            const docs = normalizeArray(st.documents).map(d =>
                d.id === newDocument.id ? { ...d, status: 'failed', error: err.message } : d
            );
            await s.update({ settings: { ...st, documents: docs } }).catch(() => {});
        });
    }

    return newDocument;
};

const deleteDocument = async (userId, shopId, documentId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    const documents = normalizeArray(settings.documents).filter(doc => doc.id !== documentId);
    await shop.update({ settings: { ...settings, documents } });
    ragService.deletePoint(documentId, shopId).catch(() => {});

    return { message: 'Document deleted successfully' };
};

// ── FAQ search ────────────────────────────────────────────────────────────────

const searchFaq = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);

    const query = payload.query || payload.category || '';
    const whereClause = { shop_id: shopId, is_active: true };
    if (payload.category) whereClause.category = payload.category;
    if (query) {
        whereClause[Op.or] = [
            { category:    { [Op.iLike]: `%${query}%` } },
            { template_en: { [Op.iLike]: `%${query}%` } },
            { template_bn: { [Op.iLike]: `%${query}%` } }
        ];
    }

    const faqs = await FaqResponse.findAll({
        where: whereClause,
        order: [['priority', 'DESC'], ['use_count', 'DESC']],
        limit: payload.limit || 10
    });
    return faqs.map(faq => ({ ...formatFaq(faq), relevance_score: 0.9 }));
};

// ── Hit tracking ──────────────────────────────────────────────────────────────

/**
 * Fix #16: Increment use_count for a matched FAQ (called by intent router).
 * Best-effort — never throws.
 */
const incrementFaqHit = async (faqId) => {
    FaqResponse.increment('use_count', { where: { id: faqId } }).catch(() => {});
};

// ── Policies ──────────────────────────────────────────────────────────────────

const getShopPolicies = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);
    const settings = normalizeObject(shop.settings);
    return normalizeObject(settings.policies);
};

// ── Language helpers ──────────────────────────────────────────────────────────

const normalizeLanguage = async (payload) => {
    if (!payload || !payload.text) {
        throw new AppError('Text is required', 400);
    }

    const text = payload.text;

    // Fix #19: Only attempt banglish dictionary lookup when relevant
    if (payload.detected_language !== 'banglish' || payload.target_language !== 'bangla') {
        return {
            original: text,
            normalized: text,
            language: payload.detected_language || 'unknown',
            confidence: 1.0,
            method_used: 'passthrough'
        };
    }

    const tokens = text.split(/\s+/);
    const dictionaryRows = await BanglishDictionary.findAll({
        where: { banglish: { [Op.in]: tokens.map(t => t.toLowerCase()) } }
    });

    const dictionary = new Map(dictionaryRows.map(row => [row.banglish, row.bangla]));
    const normalized = tokens.map(t => dictionary.get(t.toLowerCase()) || t).join(' ');

    return {
        original: text,
        normalized,
        language: 'bangla',
        confidence: 0.85,
        method_used: 'dictionary'
    };
};

const cacheLanguageLearning = async (payload) => {
    if (!payload || !payload.banglish_input || !payload.normalized_output) {
        throw new AppError('banglish_input and normalized_output are required', 400);
    }

    const existing = await BanglishDictionary.findOne({
        where: { banglish: payload.banglish_input.toLowerCase() }
    });

    if (existing) {
        await existing.update({
            bangla: payload.normalized_output,
            confidence: payload.confidence || existing.confidence
        });
        return { cached: true, id: existing.id };
    }

    const entry = await BanglishDictionary.create({
        banglish: payload.banglish_input.toLowerCase(),
        bangla: payload.normalized_output,
        confidence: payload.confidence || 95
    });

    return { cached: true, id: entry.id };
};

// ── Internal knowledge read (for AI/chatbot — no user auth required) ─────────

/**
 * Returns structured shop knowledge for system-prompt building.
 * Called by the AI chatbot pipeline — no JWT user, just shop ID.
 * Uses the same cache as getKnowledge (5 min TTL).
 */
const getKnowledgeForAI = async (shopId) => {
    const cached = await cacheService.getForShop(shopId, KNOWLEDGE_CACHE_KEY);
    if (cached) return cached;

    const [shop, faqs] = await Promise.all([
        getShop(shopId),
        FaqResponse.findAll({ where: { shop_id: shopId, is_active: true }, order: [['priority', 'DESC']] })
    ]);

    const settings = normalizeObject(shop.settings);
    const aiSettings = await shopService.getShopAiSettings(shopId).catch(() => ({}));

    const result = {
        businessInfo: normalizeObject(settings.businessInfo),
        brandingRules: normalizeObject(settings.brandingRules),
        faqs: faqs.map(formatFaq),
        documents: normalizeArray(settings.documents),
        ai_settings: aiSettings
    };

    await cacheService.setForShop(shopId, KNOWLEDGE_CACHE_KEY, result, KNOWLEDGE_CACHE_TTL).catch(() => {});
    return result;
};

// ── Lightweight per-query FAQ relevance (for system-prompt cost optimisation) ──

/**
 * Return the top-N FAQs most relevant to the incoming message using SQL token
 * matching (same approach as intent-router Stage 2).  Much cheaper than injecting
 * all 50 FAQs into every system prompt.
 *
 * Falls back to an empty array so callers can degrade gracefully to the full FAQ
 * list when no tokens match.
 *
 * @param {string} shopId
 * @param {string} message  - Customer message text
 * @param {number} [limit=5]
 * @returns {Promise<Array>} Formatted FAQ objects compatible with buildSystemPrompt
 */
const getRelevantFaqs = async (shopId, message, limit = 5) => {
    if (!shopId || !message) return [];

    try {
        const tokens = message
            .toLowerCase()
            .replace(/[^\wঀ-৿\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 3)
            .slice(0, 8); // cap to avoid giant queries

        if (tokens.length === 0) return [];

        const conditions = tokens.map(token => ({
            [Op.or]: [
                { category:    { [Op.iLike]: `%${token}%` } },
                { template_en: { [Op.iLike]: `%${token}%` } },
                { template_bn: { [Op.iLike]: `%${token}%` } },
            ]
        }));

        const rows = await FaqResponse.findAll({
            where: { shop_id: shopId, is_active: true, [Op.or]: conditions },
            order:  [['priority', 'DESC'], ['use_count', 'DESC']],
            limit,
        });

        return rows.map(formatFaq);
    } catch (_) {
        return [];
    }
};

// ── RAG query (authenticated) ─────────────────────────────────────────────────

/**
 * Fix #5: shopId always comes from the authenticated context (not request body).
 */
const queryKnowledge = async (shopId, payload) => {
    const result = await ragService.queryData({
        query: payload.query,
        limit: payload.limit || 5,
        shopId
    });
    return result;
};

module.exports = {
    getKnowledge,
    updateBusinessInfo,
    updateBrandingRules,
    listFaqs,
    createFaq,
    seedStarterFaqs,
    updateFaq,
    deleteFaq,
    listGaps,
    listDocuments,
    createDocument,
    deleteDocument,
    searchFaq,
    incrementFaqHit,
    getShopPolicies,
    normalizeLanguage,
    cacheLanguageLearning,
    getKnowledgeForAI,
    getRelevantFaqs,
    queryKnowledge
};
