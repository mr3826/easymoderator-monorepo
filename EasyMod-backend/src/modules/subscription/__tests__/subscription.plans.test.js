'use strict';

const {
    PlanCode,
    PRICING_TIERS,
    PARTNER_ORDER_TIERS,
    TOPUP_PACKS,
    getTopupPack,
    normalizePlanCode,
    calculatePartnerCharge,
} = require('../subscription.plans');

describe('subscription plan catalog', () => {
    it('defines Shuru, Growth, and Partner with the commercial entitlements', () => {
        expect(Object.keys(PRICING_TIERS)).toEqual([PlanCode.SHURU, PlanCode.GROWTH, PlanCode.PARTNER]);
        expect(PRICING_TIERS.SHURU).toEqual(expect.objectContaining({
            priceBdtMonthly: 0,
            conversationsLimit: 100,
            billingModel: 'flat_monthly',
            canPurchaseTopups: false,
        }));
        expect(PRICING_TIERS.GROWTH).toEqual(expect.objectContaining({
            priceBdtMonthly: 999,
            priceBdtYearly: 9990,
            conversationsLimit: 500,
            canPurchaseTopups: true,
        }));
        expect(PRICING_TIERS.PARTNER).toEqual(expect.objectContaining({
            priceBdtMonthly: 0,
            conversationsLimit: -1,
            billingModel: 'per_order',
            canPurchaseTopups: false,
        }));
        expect(PRICING_TIERS.SHURU.features).toEqual(PRICING_TIERS.GROWTH.features);
        expect(PRICING_TIERS.GROWTH.features).toEqual(PRICING_TIERS.PARTNER.features);
    });

    it('fails unknown and legacy plan codes closed to Shuru', () => {
        expect(normalizePlanCode('FREE')).toBe(PlanCode.SHURU);
        expect(normalizePlanCode('PACKAGE_1')).toBe(PlanCode.SHURU);
        expect(normalizePlanCode('not-a-plan')).toBe(PlanCode.SHURU);
        expect(normalizePlanCode('GROWTH')).toBe(PlanCode.GROWTH);
        expect(normalizePlanCode('PARTNER')).toBe(PlanCode.PARTNER);
    });
});

describe('Partner flat rate bands', () => {
    it.each([
        [299, 0],
        [300, 4500],
        [999, 14985],
        [1000, 12000],
        [2999, 35988],
        [3000, 30000],
    ])('calculates %s delivered orders as %s BDT', (orders, total) => {
        expect(calculatePartnerCharge(orders)).toBe(total);
    });

    it('publishes the expected band boundaries and rates', () => {
        expect(PARTNER_ORDER_TIERS).toEqual([
            { minOrders: 300, maxOrders: 999, rateBdt: 15 },
            { minOrders: 1000, maxOrders: 2999, rateBdt: 12 },
            { minOrders: 3000, maxOrders: null, rateBdt: 10 },
        ]);
    });
});

describe('top-up pack catalog', () => {
    it('publishes only the new codes and prices', () => {
        expect(TOPUP_PACKS).toEqual({
            PACK_100: { code: 'PACK_100', conversations: 100, priceBdt: 250 },
            PACK_300: { code: 'PACK_300', conversations: 300, priceBdt: 500 },
            PACK_700: { code: 'PACK_700', conversations: 700, priceBdt: 1000 },
        });
    });

    it('still resolves historical codes at their original prices', () => {
        expect(getTopupPack('TOPUP_100')).toEqual({ code: 'TOPUP_100', conversations: 100, priceBdt: 150 });
        expect(getTopupPack('PACK_100')).toEqual({ code: 'PACK_100', conversations: 100, priceBdt: 250 });
    });
});
