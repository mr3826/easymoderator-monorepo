'use strict';

jest.mock('../../modules/entities', () => ({
    Subscription: { findAll: jest.fn() },
    Shop: {},
}));
jest.mock('../../modules/audit/audit-log.entity', () => ({
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../config/redis.js', () => ({
    cacheRedis: { status: 'end', set: jest.fn(), del: jest.fn() },
}));

const { Subscription } = require('../../modules/entities');
const MonthlyUsageReset = require('../monthly-usage-reset');
const { advancePeriod } = MonthlyUsageReset;

const RUN_DATE = new Date('2026-03-01T00:00:00.000Z');

const makeSubscription = (overrides = {}) => {
    const subscription = {
        id: 'sub-1',
        shop_id: 'shop-1',
        status: 'suspended',
        billing_cycle: 'monthly',
        current_period_start: new Date('2026-01-31T12:00:00.000Z'),
        current_period_end: new Date('2026-02-28T12:00:00.000Z'),
        usage_reset_at: null,
        conversations_used: 7,
        orders_used: 2,
        products_used: 1,
        extra_charge: '12.50',
        shop: { name: 'Test Shop' },
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
    return subscription;
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('MonthlyUsageReset', () => {
    it('advances an expired period for every billing status and preserves top-ups', async () => {
        const subscription = makeSubscription({ topup_balance: 4 });
        Subscription.findAll.mockResolvedValueOnce([subscription]);

        const result = await new MonthlyUsageReset().run({ dryRun: false, runDate: RUN_DATE });

        expect(result.subscriptionsReset).toBe(1);
        expect(subscription.update).toHaveBeenCalledWith(expect.objectContaining({
            conversations_used: 0,
            orders_used: 0,
            products_used: 0,
            current_period_start: new Date('2026-02-28T12:00:00.000Z'),
            usage_reset_at: new Date('2026-01-31T12:00:00.000Z'),
        }));
        const values = subscription.update.mock.calls[0][0];
        expect(values).not.toHaveProperty('topup_balance');
    });

    it('dry-run reports expired rows without writing them', async () => {
        const subscription = makeSubscription();
        Subscription.findAll.mockResolvedValueOnce([subscription]);

        const result = await new MonthlyUsageReset().run({ dryRun: true, runDate: RUN_DATE });

        expect(result.subscriptionsReset).toBe(1);
        expect(subscription.update).not.toHaveBeenCalled();
    });

    it('skips rows without a complete billing period anchor', async () => {
        const subscription = makeSubscription({ current_period_end: null });
        Subscription.findAll.mockResolvedValueOnce([subscription]);

        const result = await new MonthlyUsageReset().run({ dryRun: false, runDate: RUN_DATE });

        expect(result.subscriptionsReset).toBe(0);
        expect(result.subscriptionsSkipped).toBe(1);
        expect(subscription.update).not.toHaveBeenCalled();
    });

    it('does not reset a period already marked at its current start', async () => {
        const job = new MonthlyUsageReset();
        const periodStart = new Date('2026-02-28T12:00:00.000Z');
        expect(job.isAlreadyReset(makeSubscription({
            current_period_start: periodStart,
            usage_reset_at: periodStart,
        }), RUN_DATE)).toBe(true);
    });

    it('clamps month-end anchors and uses UTC rather than the server locale', () => {
        expect(advancePeriod(new Date('2026-01-31T23:00:00.000Z'), 'monthly'))
            .toEqual(new Date('2026-02-28T23:00:00.000Z'));
        expect(advancePeriod(new Date('2026-02-28T23:00:00.000Z'), 'monthly'))
            .toEqual(new Date('2026-03-28T23:00:00.000Z'));
        expect(advancePeriod(new Date('2024-02-29T23:00:00.000Z'), 'yearly'))
            .toEqual(new Date('2025-02-28T23:00:00.000Z'));
    });
});
