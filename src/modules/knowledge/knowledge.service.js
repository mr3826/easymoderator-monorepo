const { Shop, UserShop, FaqResponse, BanglishDictionary } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const ragService = require('src/modules/rag/rag.service');
const crypto = require('crypto');
const { Op } = require('sequelize');

const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }

    return userShop;
};

const normalizeArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
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
        } catch (error) {
            return {};
        }
    }
    return {};
};

const getShop = async (shopId) => {
    const shop = await Shop.findByPk(shopId);
    if (!shop) {
        throw new AppError('Shop not found', 404);
    }
    return shop;
};

const getKnowledge = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);

    const faqs = await FaqResponse.findAll({
        where: { shop_id: shopId },
        order: [['priority', 'DESC']]
    });

    return {
        businessInfo: normalizeObject(settings.businessInfo),
        brandingRules: normalizeObject(settings.brandingRules),
        faqs,
        gaps: normalizeArray(settings.gaps),
        documents: normalizeArray(settings.documents)
    };
};

const updateBusinessInfo = async (userId, shopId, data) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    const businessInfo = {
        shopName: data.shopName || '',
        address: data.address || '',
        phone: data.phone || '',
        openingHours: data.openingHours || '',
        deliveryAreas: normalizeArray(data.deliveryAreas),
        paymentMethods: normalizeArray(data.paymentMethods)
    };

    const shopUpdates = {
        settings: {
            ...settings,
            businessInfo
        }
    };

    if (data.shopName && String(data.shopName).trim()) {
        shopUpdates.shop_name = data.shopName.trim();
        shopUpdates.name = data.shopName.trim();
    }

    await shop.update(shopUpdates);

    const businessText = [
        `Shop Name: ${businessInfo.shopName || ''}`,
        `Address: ${businessInfo.address || ''}`,
        `Phone: ${businessInfo.phone || ''}`,
        `Opening Hours: ${businessInfo.openingHours || ''}`,
        `Delivery Areas: ${(businessInfo.deliveryAreas || []).join(', ')}`,
        `Payment Methods: ${(businessInfo.paymentMethods || []).join(', ')}`
    ].join('\n');

    await ragService.ingestData({
        text: businessText,
        metadata: {
            documentId: `business-${shopId}`,
            shopId,
            type: 'business'
        }
    });

    return getKnowledge(userId, shopId);
};

const updateBrandingRules = async (userId, shopId, brandingRules) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    await shop.update({
        settings: {
            ...settings,
            brandingRules: brandingRules || {}
        }
    });

    const brandingText = Object.entries(brandingRules || {})
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\n');

    await ragService.ingestData({
        text: brandingText,
        metadata: {
            documentId: `branding-${shopId}`,
            shopId,
            type: 'branding'
        }
    });

    return getKnowledge(userId, shopId);
};

const listFaqs = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    return await FaqResponse.findAll({
        where: {
            shop_id: shopId
        },
        order: [['priority', 'DESC']]
    });
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

    if (newFaq.is_active) {
        const text = `Category: ${newFaq.category}\nBN: ${newFaq.template_bn || ''}\nEN: ${newFaq.template_en || ''}`;
        await ragService.ingestData({
            text,
            metadata: {
                documentId: `faq-${newFaq.id}`,
                shopId,
                type: 'faq',
                category: newFaq.category
            }
        });
    }

    return newFaq;
};

const updateFaq = async (userId, shopId, faqId, updates) => {
    await verifyShopAccess(userId, shopId);
    const faq = await FaqResponse.findOne({
        where: {
            id: faqId,
            shop_id: shopId
        }
    });

    if (!faq) {
        throw new AppError('FAQ not found', 404);
    }

    const resolvedCategory = updates.category || updates.question || faq.category;
    const resolvedTemplateEn = updates.template_en !== undefined
        ? updates.template_en
        : (updates.answer !== undefined ? updates.answer : faq.template_en);

    await faq.update({
        category: resolvedCategory,
        template_bn: updates.template_bn !== undefined ? updates.template_bn : faq.template_bn,
        template_en: resolvedTemplateEn,
        variables: updates.variables || faq.variables,
        priority: updates.priority !== undefined ? updates.priority : faq.priority,
        is_active: updates.is_active !== undefined
            ? updates.is_active
            : (updates.active !== undefined ? updates.active : faq.is_active)
    });

    if (faq.is_active) {
        const text = `Category: ${faq.category}\nBN: ${faq.template_bn || ''}\nEN: ${faq.template_en || ''}`;
        await ragService.ingestData({
            text,
            metadata: {
                documentId: `faq-${faq.id}`,
                shopId,
                type: 'faq',
                category: faq.category
            }
        });
    } else {
        await ragService.deletePoint(`faq-${faq.id}`).catch(() => {});
    }

    return faq;
};

const deleteFaq = async (userId, shopId, faqId) => {
    await verifyShopAccess(userId, shopId);
    await FaqResponse.destroy({
        where: {
            id: faqId,
            shop_id: shopId
        }
    });

    await ragService.deletePoint(`faq-${faqId}`).catch(() => {});

    return { message: 'FAQ deleted successfully' };
};

const listGaps = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);
    const settings = normalizeObject(shop.settings);
    return normalizeArray(settings.gaps);
};

const updateGaps = async (userId, shopId, gaps) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    const normalizedGaps = normalizeArray(gaps);

    await shop.update({
        settings: {
            ...settings,
            gaps: normalizedGaps
        }
    });

    return normalizedGaps;
};

const listDocuments = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);
    const settings = normalizeObject(shop.settings);
    return normalizeArray(settings.documents);
};

const createDocument = async (userId, shopId, document) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    const documents = normalizeArray(settings.documents);
    const newDocument = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'processing',
        ...document
    };

    documents.push(newDocument);

    await shop.update({
        settings: {
            ...settings,
            documents
        }
    });

    if (document?.text) {
        try {
            const ingestResult = await ragService.ingestData({
                text: document.text,
                metadata: {
                    documentId: newDocument.id,
                    shopId,
                    name: document.name,
                    contentType: document.contentType,
                    source: document.source,
                    tags: document.tags || []
                }
            });

            newDocument.status = 'indexed';
            newDocument.ingestionId = ingestResult.ingestionId;
        } catch (error) {
            newDocument.status = 'failed';
            newDocument.error = error.message || 'Failed to index document';
        }

        const updatedDocuments = normalizeArray(documents).map((doc) =>
            doc.id === newDocument.id ? newDocument : doc
        );
        await shop.update({
            settings: {
                ...settings,
                documents: updatedDocuments
            }
        });
    }

    return newDocument;
};

const deleteDocument = async (userId, shopId, documentId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const settings = normalizeObject(shop.settings);
    const documents = normalizeArray(settings.documents).filter(doc => doc.id !== documentId);
    await shop.update({
        settings: {
            ...settings,
            documents
        }
    });

    await ragService.deletePoint(documentId).catch(() => {});

    return { message: 'Document deleted successfully' };
};

const searchFaq = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);

    const whereClause = {
        shop_id: shopId,
        is_active: true
    };

    if (payload.category) {
        whereClause.category = payload.category;
    }

    if (payload.query) {
        whereClause[Op.or] = [
            { template_en: { [Op.iLike]: `%${payload.query}%` } },
            { template_bn: { [Op.iLike]: `%${payload.query}%` } }
        ];
    }

    const faqs = await FaqResponse.findAll({
        where: whereClause,
        order: [['priority', 'DESC']]
    });

    const answers = faqs.map(faq => ({
        faq_id: String(faq.id),
        question: faq.category,
        answer: payload.language === 'bangla' ? faq.template_bn : faq.template_en,
        category: faq.category,
        language: payload.language || 'english',
        relevance_score: 0.8
    }));

    return answers;
};

const getShopPolicies = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);
    const settings = normalizeObject(shop.settings);

    return normalizeObject(settings.policies);
};

const normalizeLanguage = async (payload) => {
    if (!payload || !payload.text) {
        throw new AppError('Text is required', 400);
    }

    const text = payload.text;
    if (payload.detected_language !== 'banglish' || payload.target_language !== 'bangla') {
        return {
            original: text,
            normalized: text,
            language: payload.detected_language || 'unknown',
            confidence: 0.5,
            method_used: 'dictionary'
        };
    }

    const tokens = text.split(/\s+/);
    const dictionaryRows = await BanglishDictionary.findAll({
        where: {
            banglish: {
                [Op.in]: tokens.map(token => token.toLowerCase())
            }
        }
    });

    const dictionary = new Map(dictionaryRows.map(row => [row.banglish, row.bangla]));
    const normalized = tokens.map(token => dictionary.get(token.toLowerCase()) || token).join(' ');

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

const queryKnowledge = async (payload) => {
    const result = await ragService.queryData({
        query: payload.query,
        limit: payload.limit || 5,
        shopId: payload.shop_id
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
    updateGaps,
    listDocuments,
    createDocument,
    deleteDocument,
    searchFaq,
    getShopPolicies,
    normalizeLanguage,
    cacheLanguageLearning,
    queryKnowledge
};
