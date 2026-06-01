/**
 * Partner billing + onboarding tests.
 *  - calculatePartnerCharge: tiered per-delivered-order math (pure).
 *  - partner.service.approvePartner: flips a shop's subscription to PARTNER.
 */

jest.mock('../../entities', () => ({
    PartnerApplication: { findOne: jest.fn(), create: jest.fn(), findAll: jest.fn() },
    Subscription: { findOne: jest.fn(), create: jest.fn() },
}));

const { PartnerApplication, Subscription } = require('../../entities');
const { calculatePartnerCharge, PARTNER_ORDER_TIERS } = require('../subscription.plans');
const partnerService = require('../partner.service');

describe('calculatePartnerCharge — tiered per-order rates', () => {
    it('charges the entry tier within the first bracket', () => {
        // Tier 1: up to 500 @ 15
        expect(calculatePartnerCharge(100)).toBe(100 * 15);
        expect(calculatePartnerCharge(500)).toBe(500 * 15);
    });

    it('spans bracket boundaries correctly', () => {
        // 600 = 500@15 + 100@12 = 7500 + 1200
        expect(calculatePartnerCharge(600)).toBe(500 * 15 + 100 * 12);
        // 1200 = 500@15 + 500@12 + 200@10 = 7500 + 6000 + 2000
        expect(calculatePartnerCharge(1200)).toBe(500 * 15 + 500 * 12 + 200 * 10);
    });

    it('returns 0 for no delivered orders', () => {
        expect(calculatePartnerCharge(0)).toBe(0);
    });

    it('keeps the tier table as documented (15/12/10)', () => {
        expect(PARTNER_ORDER_TIERS.map((t) => t.rateBdt)).toEqual([15, 12, 10]);
    });
});

describe('partner.service.approvePartner', () => {
    beforeEach(() => jest.clearAllMocks());

    it('flips an existing subscription to PARTNER and marks the application approved', async () => {
        const app = {
            id: 'app-1', status: 'pending', shop_id: 'shop-1',
            update: jest.fn().mockResolvedValue(undefined),
        };
        const sub = {
            shop_id: 'shop-1', plan_code: 'GROWTH',
            update: jest.fn().mockResolvedValue(undefined),
        };
        PartnerApplication.findOne.mockResolvedValue(app);
        Subscription.findOne.mockResolvedValue(sub);

        const result = await partnerService.approvePartner('app-1', { reviewerId: 'cli' });

        expect(sub.update).toHaveBeenCalledWith(expect.objectContaining({
            plan_code: 'PARTNER', billing_model: 'per_order', status: 'active', conversations_limit: -1,
        }));
        expect(app.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'approved', shop_id: 'shop-1', reviewed_by: 'cli',
        }));
        expect(result.subscription).toBe(sub);
    });

    it('binds a shopId when the application has none (public form)', async () => {
        const app = {
            id: 'app-2', status: 'pending', shop_id: null,
            update: jest.fn().mockResolvedValue(undefined),
        };
        const sub = { shop_id: 'shop-9', update: jest.fn().mockResolvedValue(undefined) };
        PartnerApplication.findOne.mockResolvedValue(app);
        Subscription.findOne.mockResolvedValue(sub);

        await partnerService.approvePartner('app-2', { shopId: 'shop-9' });

        expect(app.update).toHaveBeenCalledWith(expect.objectContaining({ shop_id: 'shop-9' }));
    });

    it('throws when no shop is linked and none provided', async () => {
        PartnerApplication.findOne.mockResolvedValue({ id: 'app-3', status: 'pending', shop_id: null });
        await expect(partnerService.approvePartner('app-3', {})).rejects.toThrow(/no shop/i);
    });

    it('throws when the application is already approved', async () => {
        PartnerApplication.findOne.mockResolvedValue({ id: 'app-4', status: 'approved', shop_id: 'shop-1' });
        await expect(partnerService.approvePartner('app-4', {})).rejects.toThrow(/already approved/i);
    });

    it('throws 404 when the application does not exist', async () => {
        PartnerApplication.findOne.mockResolvedValue(null);
        await expect(partnerService.approvePartner('missing', {})).rejects.toThrow(/not found/i);
    });
});
