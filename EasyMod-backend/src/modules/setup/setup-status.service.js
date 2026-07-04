'use strict';

const { Op } = require('sequelize');
const { MetaChannel, Product, FaqResponse } = require('../entities');
const shopService = require('../shop/shop.service');

const TASK_KEYS = Object.freeze({
    CONNECT_CHANNEL: 'connect_channel',
    SHOP_PROFILE: 'shop_profile',
    FIRST_PRODUCT: 'first_product',
    AI_SETTINGS: 'ai_settings',
    STARTER_KNOWLEDGE: 'starter_knowledge',
});

const TASK_DEFINITIONS = Object.freeze({
    [TASK_KEYS.CONNECT_CHANNEL]: {
        title: 'Connect Facebook Page',
        description: 'Connect at least one Facebook page so EasyModerator can receive and reply to customer messages.',
        ctaLabel: 'Manage channel',
        href: '/app/manage-shop/chat-settings',
    },
    [TASK_KEYS.SHOP_PROFILE]: {
        title: 'Complete shop profile',
        description: 'Add the basic shop name, support contact, delivery info, and payment methods customers need.',
        ctaLabel: 'Edit profile',
        href: '/app/manage-shop/business-info',
    },
    [TASK_KEYS.FIRST_PRODUCT]: {
        title: 'Add first product',
        description: 'Publish at least one active product. Three or more products are recommended before launch.',
        ctaLabel: 'Add product',
        href: '/app/products/add',
    },
    [TASK_KEYS.AI_SETTINGS]: {
        title: 'Configure AI reply settings',
        description: 'Keep AI replies in draft mode with a confidence threshold until the shop is ready for automation.',
        ctaLabel: 'Review AI settings',
        href: '/app/manage-shop/business-info',
    },
    [TASK_KEYS.STARTER_KNOWLEDGE]: {
        title: 'Add starter FAQ or knowledge',
        description: 'Add at least one FAQ or knowledge item so AI replies have shop-specific answers.',
        ctaLabel: 'Add knowledge',
        href: '/app/knowledge',
    },
});

function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
}

function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasAnyText(values) {
    return values.some(hasText);
}

function buildTask(key, complete, details = {}) {
    const definition = TASK_DEFINITIONS[key];
    return {
        key,
        title: definition.title,
        description: definition.description,
        status: complete ? 'complete' : 'incomplete',
        required: true,
        ctaLabel: definition.ctaLabel,
        href: definition.href,
        missing: details.missing || [],
        warnings: details.warnings || [],
        meta: details.meta || {},
    };
}

function getUsableKnowledgeDocuments(settings) {
    return normalizeArray(settings.documents).filter((document) => {
        if (!document || typeof document !== 'object') return false;
        return document.status !== 'failed';
    });
}

function assessShopProfile(shop, businessInfo, aiSettings) {
    const missing = [];
    const deliveryAreas = normalizeArray(businessInfo.deliveryAreas);
    const businessPaymentMethods = normalizeArray(businessInfo.paymentMethods);
    const aiPaymentMethods = normalizeArray(aiSettings.payment_methods);

    if (!hasAnyText([businessInfo.shopName, shop.shop_name, shop.name])) {
        missing.push('shop_name');
    }

    if (!hasAnyText([businessInfo.phone, businessInfo.email, businessInfo.supportEmail, shop.phone])) {
        missing.push('support_contact');
    }

    if (deliveryAreas.length === 0 && !hasAnyText([businessInfo.address, businessInfo.openingHours])) {
        missing.push('delivery_info');
    }

    if (businessPaymentMethods.length === 0 && aiPaymentMethods.length === 0) {
        missing.push('payment_methods');
    }

    return {
        complete: missing.length === 0,
        missing,
    };
}

function assessAiSettings(aiSettings) {
    const missing = [];
    const warnings = [];
    const confidenceThreshold = Number(aiSettings.confidence_threshold);

    if (!hasText(aiSettings.automation_mode)) {
        missing.push('automation_mode');
    }

    if (!Number.isFinite(confidenceThreshold)) {
        missing.push('confidence_threshold');
    }

    if (hasText(aiSettings.automation_mode) && aiSettings.automation_mode !== 'DRAFT') {
        warnings.push({
            code: 'AI_NOT_DRAFT',
            message: 'Draft mode is recommended for first launch verification.',
        });
    }

    return {
        complete: missing.length === 0,
        missing,
        warnings,
    };
}

async function getSetupStatus({ shopId, userId }) {
    const shop = await shopService.getShopById(shopId, userId);
    const settings = normalizeObject(shop.settings);
    const businessInfo = normalizeObject(settings.businessInfo);

    const [
        aiSettings,
        connectedFacebookPages,
        webhookVerifiedFacebookPages,
        activeProducts,
        activeFaqs,
    ] = await Promise.all([
        shopService.getShopAiSettings(shopId),
        MetaChannel.count({
            where: { shop_id: shopId, platform: 'facebook', status: 'CONNECTED' },
        }),
        MetaChannel.count({
            where: {
                shop_id: shopId,
                platform: 'facebook',
                status: 'CONNECTED',
                webhook_last_verified_at: { [Op.ne]: null },
            },
        }).catch(() => 0),
        Product.count({
            where: { shop_id: shopId, is_active: true },
        }),
        FaqResponse.count({
            where: { shop_id: shopId, is_active: true },
        }),
    ]);

    const normalizedAiSettings = normalizeObject(aiSettings);
    const usableKnowledgeDocuments = getUsableKnowledgeDocuments(settings);
    const shopProfile = assessShopProfile(shop, businessInfo, normalizedAiSettings);
    const aiSettingsStatus = assessAiSettings(normalizedAiSettings);
    const connectedChannelWarnings = connectedFacebookPages > 0 && webhookVerifiedFacebookPages === 0
        ? [{
            code: 'WEBHOOK_NOT_VERIFIED',
            message: 'No recent webhook verification was found. The connected page still counts, but send a test message before launch.',
        }]
        : [];

    const tasks = [
        buildTask(TASK_KEYS.CONNECT_CHANNEL, connectedFacebookPages > 0, {
            warnings: connectedChannelWarnings,
            meta: {
                connectedFacebookPages,
                webhookVerifiedFacebookPages,
            },
        }),
        buildTask(TASK_KEYS.SHOP_PROFILE, shopProfile.complete, {
            missing: shopProfile.missing,
        }),
        buildTask(TASK_KEYS.FIRST_PRODUCT, activeProducts > 0, {
            warnings: activeProducts > 0 && activeProducts < 3
                ? [{
                    code: 'LOW_PRODUCT_COUNT',
                    message: 'Three or more active products are recommended before launch.',
                }]
                : [],
            meta: { activeProducts },
        }),
        buildTask(TASK_KEYS.AI_SETTINGS, aiSettingsStatus.complete, {
            missing: aiSettingsStatus.missing,
            warnings: aiSettingsStatus.warnings,
            meta: {
                automationMode: normalizedAiSettings.automation_mode || null,
                confidenceThreshold: normalizedAiSettings.confidence_threshold ?? null,
            },
        }),
        buildTask(TASK_KEYS.STARTER_KNOWLEDGE, activeFaqs > 0 || usableKnowledgeDocuments.length > 0, {
            meta: {
                activeFaqs,
                knowledgeDocuments: usableKnowledgeDocuments.length,
            },
        }),
    ];

    const completedCount = tasks.filter((task) => task.status === 'complete').length;
    const totalCount = tasks.length;

    return {
        isComplete: completedCount === totalCount,
        completedCount,
        totalCount,
        progressPercent: Math.round((completedCount / totalCount) * 100),
        tasks,
        counts: {
            connectedFacebookPages,
            webhookVerifiedFacebookPages,
            activeProducts,
            activeFaqs,
            knowledgeDocuments: usableKnowledgeDocuments.length,
        },
        generatedAt: new Date().toISOString(),
    };
}

function toLegacyOnboardingStatus(setupStatus) {
    const taskStatus = Object.fromEntries(
        setupStatus.tasks.map((task) => [task.key, task.status === 'complete'])
    );
    const missing = setupStatus.tasks
        .filter((task) => task.status !== 'complete')
        .map((task) => task.key);

    return {
        completed: setupStatus.isComplete,
        can_complete: setupStatus.isComplete,
        checks: {
            facebook_connected: Boolean(taskStatus[TASK_KEYS.CONNECT_CHANNEL]),
            business_info_added: Boolean(taskStatus[TASK_KEYS.SHOP_PROFILE]),
            knowledge_added: Boolean(taskStatus[TASK_KEYS.FIRST_PRODUCT] && taskStatus[TASK_KEYS.STARTER_KNOWLEDGE]),
            assistant_test_completed: Boolean(taskStatus[TASK_KEYS.AI_SETTINGS]),
        },
        missing,
        counts: {
            connected_facebook_pages: setupStatus.counts.connectedFacebookPages,
            active_products: setupStatus.counts.activeProducts,
            active_faqs: setupStatus.counts.activeFaqs,
            ai_messages: 0,
        },
        setup_status: setupStatus,
    };
}

module.exports = {
    TASK_KEYS,
    getSetupStatus,
    toLegacyOnboardingStatus,
};
