const PlanCode = Object.freeze({
    FREE: 'FREE',
    GROWTH: 'GROWTH',
    PRO: 'PRO',
    BUSINESS: 'BUSINESS'
});

const UNLIMITED = -1;

const PRICING_TIERS = Object.freeze({
    [PlanCode.FREE]: {
        code: PlanCode.FREE,
        name: 'Free',
        priceBdtMonthly: 0,
        conversationsLimit: 100,
        ordersLimit: 50,
        productsLimit: 100,
        keyFeature: 'Basic AI chat',
        features: {
            image_understanding: false,
            advanced_ai: false,
            priority_support: false,
            custom_branding: false,
            rate_limit_per_minute: 10,
            // Language support
            allowed_languages: Object.freeze(['en']),
            language_autodetect: false,
            // Automation modes this plan may use
            allowed_automation_modes: Object.freeze(['DRAFT'])
        },
        // AI settings keys this plan may write via PUT /shop/ai-settings or PUT /shop/llm-config.
        // Any key not listed here will be rejected with HTTP 403.
        ai_settings_access: Object.freeze(['automation_mode', 'auto_reply_enabled'])
    },
    [PlanCode.GROWTH]: {
        code: PlanCode.GROWTH,
        name: 'Growth',
        priceBdtMonthly: 999,
        conversationsLimit: 1000,
        ordersLimit: 500,
        productsLimit: 1000,
        keyFeature: 'RTO Shield + Pathao',
        features: {
            image_understanding: true,
            advanced_ai: true,
            priority_support: false,
            custom_branding: false,
            rate_limit_per_minute: 30,
            allowed_languages: Object.freeze(['en', 'bn']),
            language_autodetect: false,
            allowed_automation_modes: Object.freeze(['DRAFT', 'AUTO', 'MANUAL'])
        },
        ai_settings_access: Object.freeze([
            'automation_mode', 'auto_reply_enabled', 'primary_language',
            'confidence_threshold', 'max_auto_order_value',
            'handoff_settings', 'payment_methods'
        ])
    },
    [PlanCode.PRO]: {
        code: PlanCode.PRO,
        name: 'Pro',
        priceBdtMonthly: 2499,
        conversationsLimit: 5000,
        ordersLimit: 2000,
        productsLimit: 5000,
        keyFeature: 'All channels + Analytics',
        features: {
            image_understanding: true,
            advanced_ai: true,
            priority_support: true,
            custom_branding: false,
            rate_limit_per_minute: 60,
            allowed_languages: Object.freeze(['en', 'bn', 'mixed']),
            language_autodetect: true,
            allowed_automation_modes: Object.freeze(['DRAFT', 'AUTO', 'MANUAL'])
        },
        ai_settings_access: Object.freeze([
            'automation_mode', 'auto_reply_enabled', 'primary_language',
            'confidence_threshold', 'max_auto_order_value',
            'handoff_settings', 'payment_methods',
            'required_fields', 'llm_model', 'llm_temperature'
        ])
    },
    [PlanCode.BUSINESS]: {
        code: PlanCode.BUSINESS,
        name: 'Business',
        priceBdtMonthly: 5999,
        conversationsLimit: UNLIMITED,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        keyFeature: 'White-label + API',
        features: {
            image_understanding: true,
            advanced_ai: true,
            priority_support: true,
            custom_branding: true,
            rate_limit_per_minute: 120,
            allowed_languages: Object.freeze(['en', 'bn', 'mixed']),
            language_autodetect: true,
            allowed_automation_modes: Object.freeze(['DRAFT', 'AUTO', 'MANUAL'])
        },
        ai_settings_access: Object.freeze([
            'automation_mode', 'auto_reply_enabled', 'primary_language',
            'confidence_threshold', 'max_auto_order_value',
            'handoff_settings', 'payment_methods',
            'required_fields', 'llm_model', 'llm_temperature'
        ])
    }
});

const isUnlimitedLimit = (limit) => limit === UNLIMITED || limit === null || limit < 0;

const isLimitExceeded = (used, limit) => {
    if (isUnlimitedLimit(limit)) {
        return false;
    }
    return used > limit;
};

const getTierByCode = (planCode) => {
    if (!planCode) {
        return null;
    }
    return PRICING_TIERS[String(planCode).toUpperCase()] || null;
};

const getTierByPlanName = (planName) => {
    if (!planName) {
        return null;
    }
    const normalized = String(planName).trim().toLowerCase();
    return Object.values(PRICING_TIERS).find((tier) => tier.name.toLowerCase() === normalized) || null;
};

/**
 * Return the set of AI settings keys this plan is allowed to write.
 * Falls back to FREE tier on unknown plan codes (fail-safe).
 * @param {string} planCode
 * @returns {Set<string>}
 */
const getAiSettingsAccess = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.FREE];
    return new Set(tier.ai_settings_access);
};

/**
 * Return the allowed primary_language values for this plan.
 * @param {string} planCode
 * @returns {Set<string>}
 */
const getAllowedLanguages = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.FREE];
    return new Set(tier.features.allowed_languages);
};

/**
 * Return the allowed automation_mode values for this plan.
 * @param {string} planCode
 * @returns {Set<string>}
 */
const getAllowedAutomationModes = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.FREE];
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
    getAiSettingsAccess,
    getAllowedLanguages,
    getAllowedAutomationModes
};