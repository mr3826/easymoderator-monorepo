const { Shop, UserShop } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const ragService = require('src/modules/rag/rag.service');
const crypto = require('crypto');

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

    return {
        businessInfo: {
            shopName: shop.shop_name || '',
            address: shop.address || '',
            phone: shop.phone || '',
            openingHours: shop.opening_hours || '',
            deliveryAreas: normalizeArray(shop.delivery_areas),
            paymentMethods: normalizeArray(shop.payment_methods),
        },
        brandingRules: normalizeObject(shop.branding_rules),
        faqs: normalizeArray(shop.knowledge_faqs),
        gaps: normalizeArray(shop.knowledge_gaps),
        documents: normalizeArray(shop.knowledge_documents)
    };
};

const updateBusinessInfo = async (userId, shopId, data) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const payload = {
        shop_name: data.shopName,
        address: data.address,
        phone: data.phone,
        opening_hours: data.openingHours,
        delivery_areas: normalizeArray(data.deliveryAreas),
        payment_methods: normalizeArray(data.paymentMethods)
    };

    await shop.update(payload);

    const businessText = [
        `Shop Name: ${payload.shop_name || ''}`,
        `Address: ${payload.address || ''}`,
        `Phone: ${payload.phone || ''}`,
        `Opening Hours: ${payload.opening_hours || ''}`,
        `Delivery Areas: ${(payload.delivery_areas || []).join(', ')}`,
        `Payment Methods: ${(payload.payment_methods || []).join(', ')}`
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

    await shop.update({
        branding_rules: brandingRules || {}
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
    const shop = await getShop(shopId);
    return normalizeArray(shop.knowledge_faqs);
};

const createFaq = async (userId, shopId, faq) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const faqs = normalizeArray(shop.knowledge_faqs);
    const newFaq = {
        id: crypto.randomUUID(),
        active: false,
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...faq
    };

    faqs.push(newFaq);

    await shop.update({ knowledge_faqs: faqs });

    if (newFaq.active) {
        await ragService.ingestData({
            text: `Q: ${newFaq.question}\nA: ${newFaq.answer}`,
            metadata: {
                documentId: `faq-${newFaq.id}`,
                shopId,
                type: 'faq',
                question: newFaq.question,
                answer: newFaq.answer,
                category: newFaq.category
            }
        });
    }

    return newFaq;
};

const updateFaq = async (userId, shopId, faqId, updates) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const faqs = normalizeArray(shop.knowledge_faqs).map((faq) => {
        if (faq.id !== faqId) return faq;
        return {
            ...faq,
            ...updates,
            updatedAt: new Date().toISOString()
        };
    });

    await shop.update({ knowledge_faqs: faqs });

    const updatedFaq = faqs.find(faq => faq.id === faqId) || null;
    if (updatedFaq) {
        if (updatedFaq.active) {
            await ragService.ingestData({
                text: `Q: ${updatedFaq.question}\nA: ${updatedFaq.answer}`,
                metadata: {
                    documentId: `faq-${updatedFaq.id}`,
                    shopId,
                    type: 'faq',
                    question: updatedFaq.question,
                    answer: updatedFaq.answer,
                    category: updatedFaq.category
                }
            });
        } else {
            await ragService.deletePoint(`faq-${updatedFaq.id}`);
        }
    }

    return updatedFaq;
};

const deleteFaq = async (userId, shopId, faqId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const faqs = normalizeArray(shop.knowledge_faqs).filter(faq => faq.id !== faqId);
    await shop.update({ knowledge_faqs: faqs });

    await ragService.deletePoint(`faq-${faqId}`).catch(() => {});

    return { message: 'FAQ deleted successfully' };
};

const listGaps = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);
    return normalizeArray(shop.knowledge_gaps);
};

const updateGaps = async (userId, shopId, gaps) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    await shop.update({ knowledge_gaps: normalizeArray(gaps) });

    return normalizeArray(gaps);
};

const listDocuments = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);
    return normalizeArray(shop.knowledge_documents);
};

const createDocument = async (userId, shopId, document) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const documents = normalizeArray(shop.knowledge_documents);
    const newDocument = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'processing',
        ...document
    };

    documents.push(newDocument);

    await shop.update({ knowledge_documents: documents });

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

        const updatedDocuments = normalizeArray(shop.knowledge_documents).map((doc) =>
            doc.id === newDocument.id ? newDocument : doc
        );
        await shop.update({ knowledge_documents: updatedDocuments });
    }

    return newDocument;
};

const deleteDocument = async (userId, shopId, documentId) => {
    await verifyShopAccess(userId, shopId);
    const shop = await getShop(shopId);

    const documents = normalizeArray(shop.knowledge_documents).filter(doc => doc.id !== documentId);
    await shop.update({ knowledge_documents: documents });

    await ragService.deletePoint(documentId).catch(() => {});

    return { message: 'Document deleted successfully' };
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
    deleteDocument
};
