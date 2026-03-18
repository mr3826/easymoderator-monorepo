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
            rate_limit_per_minute: 10
        }
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
            rate_limit_per_minute: 30
        }
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
            rate_limit_per_minute: 60
        }
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
            rate_limit_per_minute: 120
        }
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

module.exports = {
    PlanCode,
    UNLIMITED,
    PRICING_TIERS,
    isUnlimitedLimit,
    isLimitExceeded,
    getTierByCode,
    getTierByPlanName
};