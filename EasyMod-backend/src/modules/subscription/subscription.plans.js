/**
 * EasyModerator subscription plan definitions.
 *
 * Active plans (commercial model 2026-08-28):
 * - SHURU   : free forever (100 conversations/month).
 * - GROWTH  : flat monthly (999 BDT / 500 conversations/month) with paid top-ups.
 * - PARTNER : 0 BDT upfront; flat-band per-delivered-order billing (apply → approve).
 *
 * Conversation limits apply across ALL connected channels.
 * Supported channel: Facebook Messenger (Instagram + WhatsApp out of product scope).
 */

const { AI_REPLY_MODES } = require('../shop/ai-reply-mode');

const UNLIMITED = -1;

const PlanCode = Object.freeze({
    SHURU: 'SHURU',
    GROWTH: 'GROWTH',
    PARTNER: 'PARTNER'
});

/**
 * Partner plan: flat per-delivered-order rates (BDT).
 * Applied at month-end billing based on total delivered orders in the period.
 */
const PARTNER_ORDER_TIERS = Object.freeze([
    { minOrders: 300,  maxOrders: 999,  rateBdt: 15 },
    { minOrders: 1000, maxOrders: 2999, rateBdt: 12 },
    { minOrders: 3000, maxOrders: null, rateBdt: 10 }
]);

/**
 * Top-up conversation packs (purchased separately via bKash).
 * These codes are the current public catalog. Historical codes are resolved
 * by getTopupPack() below but are never returned by the listing service.
 */
const TOPUP_PACKS = Object.freeze({
    PACK_100: { code: 'PACK_100', conversations: 100, priceBdt: 250 },
    PACK_300: { code: 'PACK_300', conversations: 300, priceBdt: 500 },
    PACK_700: { code: 'PACK_700', conversations: 700, priceBdt: 1000 }
});

/**
 * Compatibility map for already-created top-up transactions. The old catalog
 * must remain readable so a historical purchase can still be completed or
 * audited at the price and quantity that were actually sold.
 */
const LEGACY_TOPUP_PACKS = Object.freeze({
    TOPUP_100: { code: 'TOPUP_100', conversations: 100, priceBdt: 150 },
    TOPUP_250: { code: 'TOPUP_250', conversations: 250, priceBdt: 350 },
    TOPUP_500: { code: 'TOPUP_500', conversations: 500, priceBdt: 650 },
    TOPUP_1000: { code: 'TOPUP_1000', conversations: 1000, priceBdt: 1200 }
});

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
    // Routes EVERY message to the expensive Gemini model instead of using it for
    // qualified escalation only. At ~8× the flash-lite cost per message this is
    // loss-making against the 999 BDT flat plan at the Growth conversation
    // allowance, so no plan enables it. Kept as a flag rather than deleted
    // so a future premium tier can turn it on with its own price attached.
    // See docs/ai-cost/GEMINI_FIRST_ROUTING.md.
    advanced_model_preset: false,
    allowed_languages: Object.freeze(['en', 'bn', 'mixed']),
    // Canonical business reply modes advertised to the client. All modes are
    // available on every plan; legacy aliases are read-only compatibility data.
    allowed_automation_modes: Object.freeze(Object.values(AI_REPLY_MODES)),
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
    [PlanCode.SHURU]: {
        code: PlanCode.SHURU,
        name: 'Shuru',
        billingModel: 'flat_monthly',
        priceBdtMonthly: 0,
        priceBdtYearly: 0,
        perOrderChargeBdt: null,
        conversationsLimit: 100,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        canPurchaseTopups: false,
        keyFeature: 'Free forever · 100 conversations per month',
        features: BASE_FEATURES,
        ai_settings_access: AI_SETTINGS_ALL
    },

    [PlanCode.GROWTH]: {
        code: PlanCode.GROWTH,
        name: 'Growth',
        billingModel: 'flat_monthly',
        priceBdtMonthly: 999,
        priceBdtYearly: 9990,          // ~2 months free vs monthly
        perOrderChargeBdt: null,
        conversationsLimit: 500,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        canPurchaseTopups: true,
        keyFeature: 'Your full AI sales team — one simple price',
        features: BASE_FEATURES,
        ai_settings_access: AI_SETTINGS_ALL
    },

    [PlanCode.PARTNER]: {
        code: PlanCode.PARTNER,
        name: 'Partner',
        billingModel: 'per_order',
        priceBdtMonthly: 0,
        priceBdtYearly: 0,
        perOrderChargeBdt: null,       // flat band — use PARTNER_ORDER_TIERS
        conversationsLimit: UNLIMITED,
        ordersLimit: UNLIMITED,
        productsLimit: UNLIMITED,
        canPurchaseTopups: false,
        keyFeature: '0 BDT upfront · pay per delivered order',
        features: BASE_FEATURES,
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
    // Unknown and legacy/free codes must never grant paid entitlements. The
    // subscription row's persisted conversations_limit remains authoritative,
    // while this helper safely resolves plan capabilities for old rows.
    if (normalized === 'PARTNER') return PlanCode.PARTNER;
    if (normalized === 'GROWTH') return PlanCode.GROWTH;
    return PlanCode.SHURU;
};

const getTierByCode = (planCode) => {
    if (!planCode) return null;
    return PRICING_TIERS[normalizePlanCode(planCode)] || null;
};

const getTierByPlanName = (planName) => {
    if (!planName) return null;
    const normalized = String(planName).trim().toLowerCase();
    const exact = Object.values(PRICING_TIERS).find((t) => t.name.toLowerCase() === normalized);
    if (exact) return exact;
    if (['free', 'starter', 'package 1', 'package 2'].includes(normalized)) {
        return PRICING_TIERS[PlanCode.SHURU];
    }
    return null;
};

const isPerOrderBilling = (planCode) => {
    const tier = getTierByCode(planCode);
    return tier?.billingModel === 'per_order';
};

/**
 * Calculate the per-order charge for PARTNER plan using a flat rate band.
 * @param {number} deliveredOrders - Total delivered orders in the billing period
 * @returns {number} total charge in BDT
 */
const calculatePartnerCharge = (deliveredOrders) => {
    const delivered = Math.max(0, Number(deliveredOrders) || 0);
    const tier = PARTNER_ORDER_TIERS.find(({ minOrders, maxOrders }) => (
        delivered >= minOrders && (maxOrders === null || delivered <= maxOrders)
    ));
    return tier ? delivered * tier.rateBdt : 0;
};

const getPartnerOrderTier = (deliveredOrders) => {
    const delivered = Math.max(0, Number(deliveredOrders) || 0);
    return PARTNER_ORDER_TIERS.find(({ minOrders, maxOrders }) => (
        delivered >= minOrders && (maxOrders === null || delivered <= maxOrders)
    )) || null;
};

const getAllowedLanguages = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.SHURU];
    return new Set(tier.features.allowed_languages);
};

const getAllowedAutomationModes = (planCode) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.SHURU];
    return new Set(tier.features.allowed_automation_modes);
};

const getTopupPack = (packCode) => TOPUP_PACKS[packCode] || LEGACY_TOPUP_PACKS[packCode] || null;

/**
 * Does this plan grant a named feature?
 * Unknown plan codes fall back to SHURU, and an unknown feature is false —
 * so a typo in a gate denies access rather than granting it.
 *
 * @param {string} planCode
 * @param {string} feature
 * @returns {boolean}
 */
const planHasFeature = (planCode, feature) => {
    const tier = getTierByCode(planCode) || PRICING_TIERS[PlanCode.SHURU];
    return tier.features[feature] === true;
};

/**
 * Invoice types for recurring charges, one per billing cycle.
 *
 * `yearly_subscription` exists because the type is what the dunning path reads:
 * the reconciler suspends a shop whose *recurring* invoice is past due, and
 * typing a yearly renewal as `monthly_subscription` made an annual charge look
 * like a monthly one. The definition lives here, once, because three call sites
 * used to keep their own copy of the recurring set and a new type had to be
 * added to all of them to be honoured.
 */
const InvoiceType = Object.freeze({
    MONTHLY_SUBSCRIPTION: 'monthly_subscription',
    YEARLY_SUBSCRIPTION: 'yearly_subscription',
    PARTNER_PER_ORDER: 'partner_per_order',
});

/**
 * Invoice types that gate AI when overdue. Discretionary one-offs (add-on packs,
 * proration) are deliberately absent — they only earn a reminder.
 */
const RECURRING_INVOICE_TYPES = Object.freeze([
    InvoiceType.MONTHLY_SUBSCRIPTION,
    InvoiceType.YEARLY_SUBSCRIPTION,
    InvoiceType.PARTNER_PER_ORDER,
]);

/** The recurring invoice type a subscription's billing cycle should produce. */
const recurringInvoiceTypeFor = (billingCycle) => {
    if (billingCycle === 'per_order') return InvoiceType.PARTNER_PER_ORDER;
    if (billingCycle === 'yearly') return InvoiceType.YEARLY_SUBSCRIPTION;
    return InvoiceType.MONTHLY_SUBSCRIPTION;
};

module.exports = {
    PlanCode,
    UNLIMITED,
    PRICING_TIERS,
    InvoiceType,
    RECURRING_INVOICE_TYPES,
    recurringInvoiceTypeFor,
    PARTNER_ORDER_TIERS,
    TOPUP_PACKS,
    LEGACY_TOPUP_PACKS,
    isUnlimitedLimit,
    isLimitExceeded,
    normalizePlanCode,
    getTierByCode,
    getTierByPlanName,
    isPerOrderBilling,
    calculatePartnerCharge,
    getPartnerOrderTier,
    getPerOrderCharge: calculatePartnerCharge,
    getAllowedLanguages,
    getAllowedAutomationModes,
    getTopupPack,
    planHasFeature
};
