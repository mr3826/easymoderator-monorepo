const { Shop, UserShop, FaqResponse, BanglishDictionary, MetaIntegration } = require('../entities');
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
    };

    const shopUpdates = { settings: { ...settings, businessInfo } };
    if (data.shopName && String(data.shopName).trim()) {
        shopUpdates.shop_name = data.shopName.trim();
        shopUpdates.name = data.shopName.trim();
    }

    const businessText = [
        `Shop Name: ${businessInfo.shopName}`,
        `Address: ${businessInfo.address}`,
        `Phone: ${businessInfo.phone}`,
        `Opening Hours: ${businessInfo.openingHours}`,
        `Delivery Areas: ${businessInfo.deliveryAreas.join(', ')}`,
        `Payment Methods: ${businessInfo.paymentMethods.join(', ')}`
    ].join('\n');

    const newHash = crypto.createHash('sha256').update(businessText).digest('hex');
    const staleRAG = newHash !== settings.businessInfoHash;

    shopUpdates.settings = { ...shopUpdates.settings, businessInfoHash: newHash };

    await shop.update(shopUpdates);
    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    // Non-blocking RAG ingestion — skip if content hasn't changed
    if (staleRAG) {
        ragService.ingestData({
            text: businessText,
            metadata: { documentId: `business-${shopId}`, shopId, type: 'business' }
        }).catch(err => console.warn('RAG ingest (business-info) failed:', err.message));
    }

    return { businessInfo };
};

// ── Branding rules ────────────────────────────────────────────────────────────

const updateBrandingRules = async (userId, shopId, brandingRules) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    await shop.update({ settings: { ...settings, brandingRules: brandingRules || {} } });
    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    // Fix #8: Non-blocking
    const brandingText = Object.entries(brandingRules || {})
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\n');

    ragService.ingestData({
        text: brandingText,
        metadata: { documentId: `branding-${shopId}`, shopId, type: 'branding' }
    }).catch(err => console.warn('RAG ingest (branding) failed:', err.message));

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

    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    // Fix #8: Non-blocking
    if (newFaq.is_active) {
        const text = `Category: ${newFaq.category}\nBN: ${newFaq.template_bn || ''}\nEN: ${newFaq.template_en || ''}`;
        ragService.ingestData({
            text,
            metadata: { documentId: `faq-${newFaq.id}`, shopId, type: 'faq', category: newFaq.category }
        }).catch(err => console.warn(`RAG ingest (faq-${newFaq.id}) failed:`, err.message));
    }

    return formatFaq(newFaq);
};

const updateFaq = async (userId, shopId, faqId, updates) => {
    await verifyShopAccess(userId, shopId);
    const faq = await FaqResponse.findOne({ where: { id: faqId, shop_id: shopId } });
    if (!faq) throw new AppError('FAQ not found', 404);

    await faq.update({
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
    });

    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});

    // Fix #8: Non-blocking
    if (faq.is_active) {
        const text = `Category: ${faq.category}\nBN: ${faq.template_bn || ''}\nEN: ${faq.template_en || ''}`;
        ragService.ingestData({
            text,
            metadata: { documentId: `faq-${faq.id}`, shopId, type: 'faq', category: faq.category }
        }).catch(err => console.warn(`RAG ingest (faq-${faq.id}) failed:`, err.message));
    } else {
        ragService.deletePoint(`faq-${faq.id}`, shopId).catch(() => {});
    }

    return formatFaq(faq);
};

const deleteFaq = async (userId, shopId, faqId) => {
    await verifyShopAccess(userId, shopId);
    await FaqResponse.destroy({ where: { id: faqId, shop_id: shopId } });
    await cacheService.deleteForShop(shopId, KNOWLEDGE_CACHE_KEY).catch(() => {});
    ragService.deletePoint(`faq-${faqId}`, shopId).catch(() => {});
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

/**
 * Fix #9: Semantic FAQ search via RAG with ILIKE fallback.
 */
const searchFaq = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);

    const query = payload.query || payload.category || '';

    // Stage 1: Semantic RAG search
    if (query) {
        try {
            const ragResult = await ragService.queryData({ query, limit: payload.limit || 5, shopId });
            const hits = (ragResult.results || []).filter(r =>
                r.score >= 0.6 && r.metadata?.documentId?.startsWith('faq-')
            );

            if (hits.length > 0) {
                const faqIds = hits.map(h => parseInt(h.metadata.documentId.replace('faq-', ''), 10));
                const faqs = await FaqResponse.findAll({
                    where: { id: { [Op.in]: faqIds }, shop_id: shopId, is_active: true }
                });
                // Preserve RAG ranking order
                const faqMap = new Map(faqs.map(f => [f.id, f]));
                return faqIds
                    .filter(id => faqMap.has(id))
                    .map((id, idx) => ({
                        ...formatFaq(faqMap.get(id)),
                        relevance_score: hits[idx]?.score || 0.8
                    }));
            }
        } catch (_) {
            // RAG unavailable — fall through to text search
        }
    }

    // Stage 2: ILIKE text fallback
    const whereClause = { shop_id: shopId, is_active: true };
    if (payload.category) whereClause.category = payload.category;
    if (query) {
        whereClause[Op.or] = [
            { template_en: { [Op.iLike]: `%${query}%` } },
            { template_bn: { [Op.iLike]: `%${query}%` } },
            { category: { [Op.iLike]: `%${query}%` } }
        ];
    }

    const faqs = await FaqResponse.findAll({ where: whereClause, order: [['priority', 'DESC']] });
    return faqs.map(faq => ({ ...formatFaq(faq), relevance_score: 0.8 }));
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
    queryKnowledge
};
