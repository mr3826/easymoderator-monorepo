/**
 * Partner billing + onboarding tests.
 *  - calculatePartnerCharge: flat per-delivered-order band math (pure).
 *  - partner.service.approvePartner: flips a shop's subscription to PARTNER.
 */

jest.mock('../../entities', () => ({
    PartnerApplication: { findOne: jest.fn(), create: jest.fn(), findAll: jest.fn() },
    Subscription: { findOne: jest.fn(), create: jest.fn() },
    Order: { count: jest.fn() },
}));

const { PartnerApplication, Subscription, Order } = require('../../entities');
const { calculatePartnerCharge, PARTNER_ORDER_TIERS } = require('../subscription.plans');
const partnerService = require('../partner.service');

describe('calculatePartnerCharge — flat per-order bands', () => {
    it('does not charge below the 300-order qualification threshold', () => {
        expect(calculatePartnerCharge(299)).toBe(0);
    });

    it.each([
        [300, 300 * 15],
        [999, 999 * 15],
        [1000, 1000 * 12],
        [2999, 2999 * 12],
        [3000, 3000 * 10],
    ])('charges every order at the rate for the %s band', (orders, expected) => {
        expect(calculatePartnerCharge(orders)).toBe(expected);
    });

    it('returns 0 for no delivered orders', () => {
        expect(calculatePartnerCharge(0)).toBe(0);
    });

    it('keeps the flat band table as documented', () => {
        expect(PARTNER_ORDER_TIERS.map((t) => [t.minOrders, t.maxOrders])).toEqual([
            [300, 999], [1000, 2999], [3000, null]
        ]);
        expect(PARTNER_ORDER_TIERS.map((t) => t.rateBdt)).toEqual([15, 12, 10]);
    });
});

describe('countRecentDeliveredOrders', () => {
    it('counts only delivered orders in the rolling window', async () => {
        Order.count.mockResolvedValueOnce(301);
        const { countRecentDeliveredOrders } = partnerService;

        await expect(countRecentDeliveredOrders('shop-1')).resolves.toBe(301);
        expect(Order.count).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                shop_id: 'shop-1',
                order_status: 'delivered',
                delivered_at: expect.any(Object),
            }),
        }));
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
