'use strict';

const express = require('express');
const {
    PlanCode,
    PRICING_TIERS,
    TOPUP_PACKS,
    PARTNER_ORDER_TIERS
} = require('../subscription/subscription.plans');

const router = express.Router();

const PLAN_DESCRIPTIONS = Object.freeze({
    [PlanCode.SHURU]: 'Free forever for getting started with Messenger sales.',
    [PlanCode.GROWTH]: 'The full Messenger sales assistant for growing shops.',
    [PlanCode.PARTNER]: 'No upfront fee; pay for successfully delivered orders.'
});

const toPublicPlan = (tier) => ({
    code: tier.code,
    name: tier.name,
    description: PLAN_DESCRIPTIONS[tier.code],
    billing_model: tier.billingModel,
    price_bdt_monthly: tier.priceBdtMonthly,
    price_bdt_yearly: tier.priceBdtYearly,
    conversations_limit: tier.conversationsLimit,
    orders_limit: tier.ordersLimit,
    products_limit: tier.productsLimit,
    can_purchase_topups: tier.canPurchaseTopups,
    per_order_charge_bdt: tier.perOrderChargeBdt,
    features: tier.features,
    topup_packs: tier.canPurchaseTopups ? Object.values(TOPUP_PACKS) : [],
    partner_order_tiers: tier.code === PlanCode.PARTNER ? PARTNER_ORDER_TIERS : []
});

// Public by design: the marketing origin cannot call the authenticated
// subscription router, and prices/entitlements must have one server source.
router.get('/', (_req, res) => {
    res.json({
        success: true,
        data: Object.values(PRICING_TIERS).map(toPublicPlan)
    });
});

module.exports = router;
