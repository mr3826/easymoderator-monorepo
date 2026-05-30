/**
 * Easy Moderator subscription plan definitions.
 *
 * Active plans:
 * - PACKAGE_1 : flat monthly (750 BDT / 500 moderator conversations)
 * - PACKAGE_2 : flat monthly (1950 BDT / 1500 moderator conversations)
 * - PARTNER   : 0 BDT upfront; tiered per-delivered-order billing
 *
 * Conversation limits apply across ALL connected channels.
 * Supported channels: Facebook Messenger and Instagram Direct (WhatsApp removed 2026-05-20).
 */

const UNLIMITED = -1;

const PlanCode = Object.freeze({
    FREE: 'FREE',
    PACKAGE_1: 'PACKAGE_1',
    PACKAGE_2: 'PACKAGE_2',
    PARTNER: 'PARTNER'
});

/**
 * Partner plan: tiered per-delivered-order rates (BDT)
 * Applied at month-end billing based on total delivered orders that month.
 */
const PARTNER_ORDER_TIERS = Object.freeze([
    { upTo: 500,  rateBdt: 15 },
    { upTo: 1000, rateBdt: 12 },
    { upTo: null, rateBdt: 10 }   // null = no upper bound
]);

/**
 * Top-up conversation packs (purchased separately via BKash)
 */
const TOPUP_PACKS = Object.freeze({
    TOPUP_100:  { code: 'TOPUP_100',  conversations: 100,  priceBdt: 150 },
    TOPUP_250:  { code: 'TOPUP_250',  conversations: 250,  priceBdt: 350 },
    TOPUP_500:  { code: 'TOPUP_500',  conversations: 500,  priceBdt: 650 },
    TOPUP_1000: { code: 'TOPUP_1000', conversations: 1000, priceBdt: 1200 }
});

/**
 * Conversation buffer granted when the plan limit is fully exhausted.
 * These are charged against the next billing cycle.
 */
const THRESHOLD_BUFFER = 50;

const BASE_FEATURES = Object.freeze({
    // Supported channels: Facebook Messenger + Instagram Direct
    ai_auto_reply: true,
    facebook_channel: true,
    instagram_channel: true,
    webchat_channel: true,
    telegram_channel: true,
    comment_auto_reply: true,
    banglish_ai: true,
    tone_persona: true,
    image_understanding: true,
    voice_note_transcription: true,
    campaign_broadcast: true,
    max_campaigns_per_month: UNLIMITED,
    rto_shield: true,
    rto_shield_level: 'advanced',
    delivery_auto_zone: true,
    all_bd_gateways: true,
    analytics_days: 30,
    analytics_export: true,
    fcommerce_kpis: true,
    customer_journey_timeline: true,
    priority_support: true,
    api_access: false,
    advanced_ai: true,
    allowed_languages: Object.freeze(['en', 'bn', 'mixed']),
    // Canonical automation modes advertised to the client (matches the
    // MetaChannelSettings ENUM). All modes are available on every plan.
    allowed_automation_modes: Object.freeze(['AI_ACTIVE', 'AI_SUGGEST_ONLY', 'MANUAL', 'DRAFT']),
    rate_limit_per_minute: 40
});

/**
 * FREE tier — a genuine no-card on-ramp for new BD shop owners.
 * Hard-capped (NO threshold buffer, NO overage charge, NO invoice — enforced in
 * conversation-limit.middleware, daily-overage-calculator and invoice-generator).
 * Keeps the core differentiators that prove value (Bangla/Banglish AI auto-reply,
 * FB+IG, comment auto-reply, basic RTO shield) and gates the cost/premium ones.
 */
const FREE_FEATURES = Object.freeze({
    ...BASE_FEATURES,
    image_understanding: false,        // vision API cost — gated
    voice_note_transcription: false,   // transcription cost — gated
    tone_persona: false,
    campaign_broadcast: false,
    max_campaigns_per_month: 0,
    rto_shield_level: 'basic',
    analytics_days: 3,
    analytics_export: false,
    fcommerce_kpis: false,
    customer_journey_timeline: false,
    priority_support: false,
    api_access: false,
    advanced_ai: false,                // gates premium AI UI/settings; LLM cost is
                                       // capped by the 50-conv hard cap + low rate limit
    rate_limit_per_minute: 8
});

const AI_SETTINGS_ALL = Object.freeze([
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
    'custom_webhook',
]);

// FREE tier exposes only the essential settings; advanced/model/API knobs are gated.
const AI_SETTINGS_FREE = Object.freeze([
    'automation_mode',
    'auto_reply_enabled',
    'primary_language',
    'confidence_threshold',
    'handoff_settings',
    'payment_methods',
    'required_fields',
]);

const PRICING_TIERS = Object.freeze({
    [PlanCode.FREE]: {
        code: PlanCode.FREE,
        name: 'Free',
        billingModel: 'free',
        priceBdtMonthly: 0,
        priceBdtYearly: 0,
        perOrderChargeBdt: null,
        conversationsLimit: 50,
        ordersLimit: UNLIMITED,        // never cap real sales — only the AI cost driver
        productsLimit: 30,
        keyFeature: 'Free forever — 50 AI conversations/month',
        features: FREE_FEATURES,
        ai_settings_access: AI_SETTINGS_FREE
    },

    [PlanCode.PACKAGE_1]: {
        code: PlanCode.PACKAGE_1,
        name: 'Package 1',
        billingModel: 'flat_monthly',
        priceBdtMonthly: 750,
        priceBdtYearly: 7500,
        perOrderChargeBdt: null,
        conversationsLimit: 500,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        keyFeature: 'AI Inbox — 500 moderator conversations/month',
        features: Object.freeze({
            ...BASE_FEATURES,
            analytics_days: 7,
            api_access: false,
            rate_limit_per_minute: 15
        }),
        ai_settings_access: AI_SETTINGS_ALL
    },

    [PlanCode.PACKAGE_2]: {
        code: PlanCode.PACKAGE_2,
        name: 'Package 2',
        billingModel: 'flat_monthly',
        priceBdtMonthly: 1950,
        priceBdtYearly: 19500,
        perOrderChargeBdt: null,
        conversationsLimit: 1500,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        keyFeature: 'Full AI Inbox — 1500 moderator conversations/month',
        features: Object.freeze({
            ...BASE_FEATURES,
            analytics_days: 30,
            api_access: false,
            rate_limit_per_minute: 40
        }),
        ai_settings_access: AI_SETTINGS_ALL
    },

    [PlanCode.PARTNER]: {
        code: PlanCode.PARTNER,
        name: 'Partner',
        billingModel: 'per_order',
        priceBdtMonthly: 0,
        priceBdtYearly: 0,
        perOrderChargeBdt: null,       // tiered — use PARTNER_ORDER_TIERS
        conversationsLimit: UNLIMITED,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        keyFeature: '0 BDT upfront · pay per delivered order',
        features: Object.freeze({
            ...BASE_FEATURES,
            analytics_days: 90,
            api_access: true,
            rate_limit_per_minute: 100
        }),
        ai_settings_access: AI_SETTINGS_ALL
    }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const isUnlimitedLimit = (limit) => limit === UNLIMITED || limit === null || limit < 0;

const isLimitExceeded = (used, limit) => {
    if (isUnlimitedLimit(limit)) return false;
    return used > limit;
};

const normalizePlanCode = (planCode) => {
    const normalized = String(planCode || '').toUpperCase();
    // FREE is now a first-class plan (no longer an alias of PACKAGE_1).
    // Legacy aliases for renamed paid tiers only:
    if (['STARTER', 'PRO', 'BUSINESS'].includes(normalized)) return PlanCode.PACKAGE_1;
    if (['GROWTH'].includes(normalized)) return PlanCode.PACKAGE_2;
    return normalized;
};

const getTierByCode = (planCode) => {
    if (!planCode) return null;
    return PRICING_TIERS[normalizePlanCode(planCode)] || null;
};

const getTierByPlanName = (planName) => {
    if (!planName) return null;
    const normalized = String(planName).trim().toLowerCase();
    return Object.values(PRICING_TIERS).find((t) => t.name.toLowerCase() === normalized) || null;
};

const isPerOrderBilling = (planCode) => {
    const tier = getTierByCode(planCode);
    return tier?.billingModel === 'per_order';
};

/**
 * Calculate the per-order charge for PARTNER plan using tiered rates.
 * @param {number} deliveredOrders - Total delivered orders in the billing period
 * @returns {number} total charge in BDT
 */
const calculatePartnerCharge = (deliveredOrders) => {
    let remaining = deliveredOrders;
    let total = 0;
    let prevUpTo = 0;

    for (const tier of PARTNER_ORDER_TIERS) {
        if (remaining <= 0) break;
        const bracketSize = tier.upTo !== null ? tier.upTo - prevUpTo : remaining;
        const ordersInBracket = Math.min(remaining, bracketSize);
        total += ordersInBracket * tier.rateBdt;
        remaining -= ordersInBracket;
        if (tier.upTo !== null) prevUpTo = tier.upTo;
    }

    return total;
};

const getAllowedLanguages = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.PACKAGE_1];
    return new Set(tier.features.allowed_languages);
};

const getAllowedAutomationModes = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.PACKAGE_1];
    return new Set(tier.features.allowed_automation_modes);
};

const getTopupPack = (packCode) => TOPUP_PACKS[packCode] || null;

module.exports = {
    PlanCode,
    UNLIMITED,
    THRESHOLD_BUFFER,
    PRICING_TIERS,
    PARTNER_ORDER_TIERS,
    TOPUP_PACKS,
    isUnlimitedLimit,
    isLimitExceeded,
    getTierByCode,
    getTierByPlanName,
    isPerOrderBilling,
    calculatePartnerCharge,
    getPerOrderCharge: calculatePartnerCharge,
    getAllowedLanguages,
    getAllowedAutomationModes,
    getTopupPack
};
