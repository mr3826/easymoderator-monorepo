/**
 * EasyModerator subscription plan definitions.
 *
 * Active plans (simplified 2026-05-31):
 * - GROWTH  : flat monthly (999 BDT / 300 moderator conversations + 50 grace buffer).
 *             Fronted by a card-less 14-day trial (a `trialing` status, not a plan).
 *             Every feature is included; packages no longer differ by feature.
 * - PARTNER : 0 BDT upfront; tiered per-delivered-order billing (apply → approve).
 *
 * Conversation limits apply across ALL connected channels.
 * Supported channel: Facebook Messenger (Instagram + WhatsApp out of product scope).
 */

const UNLIMITED = -1;

const PlanCode = Object.freeze({
    GROWTH: 'GROWTH',
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
    // The only connectable channel is Facebook Messenger. The
    // instagram/webchat/telegram capability flags below are legacy taxonomy
    // kept for historical/non-Meta conversation records — they are NOT
    // connectable channels in the product and are not surfaced as connect options.
    ai_auto_reply: true,
    facebook_channel: true,
    instagram_channel: false,
    webchat_channel: false,
    telegram_channel: false,
    comment_auto_reply: false,
    banglish_ai: true,
    tone_persona: true,
    image_understanding: true,
    voice_note_transcription: true,
    campaign_broadcast: false,
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

const PRICING_TIERS = Object.freeze({
    [PlanCode.GROWTH]: {
        code: PlanCode.GROWTH,
        name: 'Growth',
        billingModel: 'flat_monthly',
        priceBdtMonthly: 999,
        priceBdtYearly: 9990,          // ~2 months free vs monthly
        perOrderChargeBdt: null,
        // Hidden fair-use cap (300) + 50 free grace buffer applied by the
        // conversation-limit middleware. Never marketed as the headline.
        conversationsLimit: 300,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        keyFeature: 'Your full AI sales team — one simple price',
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
    // Single paid plan now. Every legacy/free/renamed flat tier collapses to GROWTH;
    // only PARTNER is distinct. Unknown/empty also defaults to GROWTH (fail-safe: a
    // shop should always have full AI rather than be locked out).
    if (normalized === 'PARTNER') return PlanCode.PARTNER;
    return PlanCode.GROWTH;
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
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.GROWTH];
    return new Set(tier.features.allowed_languages);
};

const getAllowedAutomationModes = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.GROWTH];
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
