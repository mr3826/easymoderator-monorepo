'use strict';

jest.mock('../../entities', () => ({
    Subscription: { findOne: jest.fn(), create: jest.fn() },
    Invoice: { create: jest.fn() },
    UsageEvent: { findOne: jest.fn() },
    AuditLog: { create: jest.fn(), findOne: jest.fn(), findOrCreate: jest.fn() },
    UserShop: { findOne: jest.fn() },
    Order: { count: jest.fn() },
}));
jest.mock('../../../utils/cache.service', () => ({ clearForShop: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { Subscription, Invoice, UserShop } = require('../../entities');
const cacheService = require('../../../utils/cache.service');
const subscriptionService = require('../subscription.service');

const makeSubscription = (overrides = {}) => ({
    id: 'sub-1',
    shop_id: 'shop-1',
    plan_code: 'SHURU',
    plan_name: 'Shuru',
    plan_price: 0,
    billing_cycle: 'monthly',
    conversations_limit: 100,
    orders_limit: -1,
    products_limit: -1,
    conversations_used: 12,
    orders_used: 0,
    products_used: 0,
    topup_balance: 30,
    current_period_start: new Date('2026-08-01T00:00:00.000Z'),
    current_period_end: new Date('2026-09-01T00:00:00.000Z'),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    UserShop.findOne.mockResolvedValue({ id: 'membership-1' });
    Invoice.create.mockResolvedValue({ id: 'invoice-1' });
});

describe('commercial subscription lifecycle', () => {
    it('creates Shuru as the free-forever default with a synthetic monthly period', async () => {
        const created = makeSubscription();
        Subscription.create.mockResolvedValueOnce(created);

        const result = await subscriptionService.createDefaultSubscription('shop-1');

        expect(Subscription.create).toHaveBeenCalledWith(expect.objectContaining({
            plan_code: 'SHURU',
            plan_name: 'Shuru',
            plan_price: 0,
            conversations_limit: 100,
            status: 'active',
            billing_cycle: 'monthly',
            trial_ends_at: null,
        }));
        expect(result).toBe(created);
    });

    it('does not activate Growth without a successful payment', async () => {
        const subscription = makeSubscription();
        Subscription.findOne.mockResolvedValueOnce(subscription);

        await expect(subscriptionService.updatePlan('shop-1', 'user-1', {
            plan_code: 'GROWTH',
            plan_price: 1,
            conversations_limit: 999,
        })).rejects.toMatchObject({ status: 402, code: 'PAYMENT_REQUIRED' });
        expect(subscription.update).not.toHaveBeenCalled();
    });

    it('creates a server-priced pending invoice for a Shuru to Growth upgrade', async () => {
        const subscription = makeSubscription();
        Subscription.findOne.mockResolvedValueOnce(subscription);

        await subscriptionService.ensureRenewalInvoice('shop-1', 'user-1', 'GROWTH');

        expect(Invoice.create).toHaveBeenCalledWith(expect.objectContaining({
            invoice_type: 'monthly_subscription',
            amount: 999,
            base_amount: 999,
            metadata: expect.objectContaining({ target_plan_code: 'GROWTH' }),
        }));
    });

    it('preserves an annual Growth billing cycle when an annual invoice is paid', async () => {
        const subscription = makeSubscription({
            plan_code: 'GROWTH',
            plan_name: 'Growth',
            plan_price: 9990,
            billing_cycle: 'yearly',
            conversations_limit: 300,
        });

        await subscriptionService.activateFromPaidInvoice(subscription, {
            targetPlanCode: 'GROWTH',
            targetBillingCycle: 'yearly',
        });

        expect(subscription.update).toHaveBeenCalledWith(expect.objectContaining({
            plan_code: 'GROWTH',
            billing_cycle: 'yearly',
            plan_price: 9990,
            conversations_limit: 500,
        }));
    });

    it('keeps the existing Partner period when a late invoice is paid', async () => {
        const periodStart = new Date('2026-08-01T00:00:00.000Z');
        const periodEnd = new Date('2026-09-01T00:00:00.000Z');
        const subscription = makeSubscription({
            plan_code: 'PARTNER',
            plan_name: 'Partner',
            plan_price: 0,
            billing_model: 'per_order',
            billing_cycle: 'monthly',
            current_period_start: periodStart,
            current_period_end: periodEnd,
            next_billing_date: periodEnd,
            usage_reset_at: periodStart,
        });

        await subscriptionService.activateFromPaidInvoice(subscription, {
            preservePeriod: true,
            billingPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
        });

        expect(subscription.update).toHaveBeenCalledWith(expect.objectContaining({
            current_period_start: periodStart,
            current_period_end: periodEnd,
            next_billing_date: periodEnd,
            usage_reset_at: periodStart,
        }));
    });

    it('rejects Partner and unknown plan selections from the merchant plan endpoint', async () => {
        const subscription = makeSubscription();
        Subscription.findOne.mockResolvedValue(subscription);

        await expect(subscriptionService.updatePlan('shop-1', 'user-1', { plan_code: 'PARTNER' }))
            .rejects.toMatchObject({ status: 403 });
        await expect(subscriptionService.updatePlan('shop-1', 'user-1', { plan_code: 'UNKNOWN' }))
            .rejects.toMatchObject({ status: 403 });
        expect(subscription.update).not.toHaveBeenCalled();
    });
});
