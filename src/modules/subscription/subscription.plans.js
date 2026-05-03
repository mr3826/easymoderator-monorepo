/**
 * Easy Moderator subscription plan definitions.
 *
 * Active plans:
 * - STARTER: flat monthly (750 BDT)
 * - GROWTH: flat monthly (1950 BDT)
 * - PARTNER: pay-per-delivered-order (22 BDT)
 */

const UNLIMITED = -1;

const PlanCode = Object.freeze({
    STARTER: 'STARTER',
    GROWTH: 'GROWTH',
    PARTNER: 'PARTNER'
});

const BASE_FEATURES = Object.freeze({
    facebook_channel: false,
    whatsapp_channel: false,
    instagram_channel: false,
    max_facebook_pages: 1,
    max_whatsapp_numbers: 0,
    max_instagram_accounts: 0,
    comment_auto_reply: false,
    banglish_ai: true,
    tone_persona: false,
    image_understanding: false,
    voice_note_transcription: false,
    campaign_broadcast: false,
    max_campaigns_per_month: 0,
    rto_shield: true,
    rto_shield_level: 'basic',
    delivery_auto_zone: false,
    all_bd_gateways: false,
    analytics_days: 7,
    analytics_export: false,
    fcommerce_kpis: false,
    customer_journey_timeline: false,
    whatsapp_catalog_sync: false,
    priority_support: false,
    api_access: false,
    advanced_ai: false,
    allowed_channels: Object.freeze(['facebook']),
    allowed_languages: Object.freeze(['en', 'bn', 'mixed']),
    allowed_automation_modes: Object.freeze(['DRAFT', 'MANUAL']),
    rate_limit_per_minute: 15
});

const PRICING_TIERS = Object.freeze({
    [PlanCode.STARTER]: {
        code: PlanCode.STARTER,
        name: 'Starter',
        billingModel: 'flat_monthly',
        priceBdtMonthly: 750,
        priceBdtYearly: 7500,
        perOrderChargeBdt: null,
        extraChannelPriceBdt: null,
        conversationsLimit: UNLIMITED,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        maxIncludedChannels: 1,
        keyFeature: 'AI Inbox + RTO Shield',
        features: Object.freeze({
            ...BASE_FEATURES
        }),
        ai_settings_access: Object.freeze([
            'automation_mode',
            'auto_reply_enabled',
            'primary_language',
            'confidence_threshold'
        ])
    },

    [PlanCode.GROWTH]: {
        code: PlanCode.GROWTH,
        name: 'Growth',
        billingModel: 'flat_monthly',
        priceBdtMonthly: 1950,
        priceBdtYearly: 19500,
        perOrderChargeBdt: null,
        extraChannelPriceBdt: 200,
        conversationsLimit: UNLIMITED,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        maxIncludedChannels: 3,
        keyFeature: 'Auto-Reply + Broadcast + 3 channels',
        features: Object.freeze({
            ...BASE_FEATURES,
            facebook_channel: true,
            whatsapp_channel: false,
            instagram_channel: true,
            max_facebook_pages: 2,
            max_whatsapp_numbers: 0,
            max_instagram_accounts: 1,
            comment_auto_reply: true,
            tone_persona: true,
            image_understanding: true,
            voice_note_transcription: true,
            campaign_broadcast: true,
            max_campaigns_per_month: UNLIMITED,
            rto_shield_level: 'advanced',
            delivery_auto_zone: true,
            all_bd_gateways: true,
            analytics_days: 30,
            analytics_export: true,
            fcommerce_kpis: true,
            customer_journey_timeline: true,
            priority_support: true,
            advanced_ai: true,
            allowed_channels: Object.freeze(['facebook', 'instagram']),
            allowed_automation_modes: Object.freeze(['DRAFT', 'MANUAL', 'AUTO']),
            rate_limit_per_minute: 40
        }),
        ai_settings_access: Object.freeze([
            'automation_mode',
            'auto_reply_enabled',
            'primary_language',
            'confidence_threshold',
            'max_auto_order_value',
            'handoff_settings',
            'payment_methods',
            'tone_persona'
        ])
    },

    [PlanCode.PARTNER]: {
        code: PlanCode.PARTNER,
        name: 'Partner',
        billingModel: 'per_order',
        priceBdtMonthly: 0,
        priceBdtYearly: 0,
        perOrderChargeBdt: 22,
        extraChannelPriceBdt: null,
        conversationsLimit: UNLIMITED,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        maxIncludedChannels: UNLIMITED,
        keyFeature: 'No monthly fee, pay 22 BDT per delivered order',
        features: Object.freeze({
            ...BASE_FEATURES,
            facebook_channel: true,
            whatsapp_channel: false,
            instagram_channel: true,
            max_facebook_pages: UNLIMITED,
            max_whatsapp_numbers: 0,
            max_instagram_accounts: UNLIMITED,
            comment_auto_reply: true,
            tone_persona: true,
            image_understanding: true,
            voice_note_transcription: true,
            campaign_broadcast: true,
            max_campaigns_per_month: UNLIMITED,
            rto_shield_level: 'advanced',
            delivery_auto_zone: true,
            all_bd_gateways: true,
            analytics_days: 90,
            analytics_export: true,
            fcommerce_kpis: true,
            customer_journey_timeline: true,
            whatsapp_catalog_sync: false,
            priority_support: true,
            api_access: true,
            advanced_ai: true,
            allowed_channels: Object.freeze(['facebook', 'instagram']),
            allowed_automation_modes: Object.freeze(['DRAFT', 'MANUAL', 'AUTO']),
            rate_limit_per_minute: 100
        }),
        ai_settings_access: Object.freeze([
            'automation_mode',
            'auto_reply_enabled',
            'primary_language',
            'confidence_threshold',
            'max_auto_order_value',
            'handoff_settings',
            'payment_methods',
            'tone_persona',
            'required_fields',
            'llm_model',
            'llm_temperature',
            'api_enable',
            'custom_webhook'
        ])
    }
});

const isUnlimitedLimit = (limit) => limit === UNLIMITED || limit === null || limit < 0;

const isLimitExceeded = (used, limit) => {
    if (isUnlimitedLimit(limit)) return false;
    return used > limit;
};

const normalizePlanCode = (planCode) => {
    const normalized = String(planCode || '').toUpperCase();
    if (normalized === 'FREE' || normalized === 'PRO' || normalized === 'BUSINESS') {
        return PlanCode.STARTER;
    }
    return normalized;
};

const getTierByCode = (planCode) => {
    if (!planCode) return null;
    return PRICING_TIERS[normalizePlanCode(planCode)] || null;
};

const getTierByPlanName = (planName) => {
    if (!planName) return null;
    const normalized = String(planName).trim().toLowerCase();
    return Object.values(PRICING_TIERS).find((tier) => tier.name.toLowerCase() === normalized) || null;
};

const isPerOrderBilling = (planCode) => {
    const tier = getTierByCode(planCode);
    return tier?.billingModel === 'per_order';
};

const getPerOrderCharge = (planCode) => {
    const tier = getTierByCode(planCode);
    return tier?.perOrderChargeBdt ?? 0;
};

const getAiSettingsAccess = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.STARTER];
    return new Set(tier.ai_settings_access);
};

const getAllowedLanguages = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.STARTER];
    return new Set(tier.features.allowed_languages);
};

const getAllowedAutomationModes = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.STARTER];
    return new Set(tier.features.allowed_automation_modes);
};

module.exports = {
    PlanCode,
    UNLIMITED,
    PRICING_TIERS,
    isUnlimitedLimit,
    isLimitExceeded,
    getTierByCode,
    getTierByPlanName,
    isPerOrderBilling,
    getPerOrderCharge,
    getAiSettingsAccess,
    getAllowedLanguages,
    getAllowedAutomationModes
};
