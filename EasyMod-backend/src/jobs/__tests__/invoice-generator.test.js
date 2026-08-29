/**
 * InvoiceGenerator — a subscription is billed when its paid period ends, not
 * when the calendar month turns (DB mocked).
 *
 * The defect these cover: the generator billed every `status:'active'`
 * subscription on the 1st of the month with no reference to its own billing
 * period, so a yearly subscriber was charged the full annual amount a month
 * into a year they had already paid for, given three days to pay, and then
 * suspended by the failed-payment reconciler.
 */

jest.mock('../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } })),
    },
}));

jest.mock('../../modules/entities', () => ({
    Subscription: { findAll: jest.fn() },
    Invoice: { findOne: jest.fn(), create: jest.fn() },
    Shop: {},
    Order: { count: jest.fn().mockResolvedValue(0) },
    PartnerBillingAdjustment: { findAll: jest.fn().mockResolvedValue([]) },
}));

const { Subscription, Invoice } = require('../../modules/entities');
const { Order, PartnerBillingAdjustment } = require('../../modules/entities');
const InvoiceGenerator = require('../invoice-generator');

const MONTHLY_PRICE = 999;
const YEARLY_PRICE = 11988;

const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const addYears = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };

const RUN_DATE = new Date('2026-09-01T01:00:00.000Z');

const makeSubscription = (overrides = {}) => ({
    id: 'sub-1',
    shop_id: 'shop-1',
    plan_code: 'GROWTH',
    plan_name: 'Growth',
    plan_price: String(MONTHLY_PRICE),
    billing_model: 'flat_monthly',
    billing_cycle: 'monthly',
    status: 'active',
    conversations_used: 0,
    orders_used: 0,
    products_used: 0,
    extra_charge: '0.00',
    shop: { id: 'shop-1', name: 'Test Shop' },
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

/** A yearly subscriber who paid on `paidAt` and is entitled for a year. */
const yearlySubscription = (paidAt, overrides = {}) => makeSubscription({
    billing_cycle: 'yearly',
    plan_price: String(YEARLY_PRICE),
    current_period_start: paidAt,
    current_period_end: addYears(paidAt, 1),
    next_billing_date: addYears(paidAt, 1),
    ...overrides,
});

const monthlySubscription = (paidAt, overrides = {}) => makeSubscription({
    billing_cycle: 'monthly',
    plan_price: String(MONTHLY_PRICE),
    current_period_start: paidAt,
    current_period_end: addMonths(paidAt, 1),
    next_billing_date: addMonths(paidAt, 1),
    ...overrides,
});

const runWith = async (subscriptions, runDate = RUN_DATE) => {
    Subscription.findAll.mockResolvedValueOnce(subscriptions);
    const job = new InvoiceGenerator();
    return job.run({ dryRun: false, runDate });
};

beforeEach(() => {
    jest.clearAllMocks();
    Invoice.findOne.mockResolvedValue(null);
    Invoice.create.mockImplementation(async (v) => ({ id: 'inv-1', ...v }));
    PartnerBillingAdjustment.findAll.mockResolvedValue([]);
});

describe('BILLING-YEARLY-002 — one month into a paid year', () => {
    it('issues no invoice while the annual entitlement is still valid', async () => {
        // Paid 2026-08-10, entitled to 2027-08-10. The cron runs on 2026-09-01.
        const sub = yearlySubscription(new Date('2026-08-10T11:40:39.602Z'));

        const res = await runWith([sub]);

        expect(Invoice.create).not.toHaveBeenCalled();
        expect(res.invoicesGenerated).toBe(0);
        expect(res.invoicesSkipped).toBe(1);
    });

    it('issues no invoice on any monthly run across the whole year', async () => {
        const paidAt = new Date('2026-08-10T11:40:39.602Z');

        for (let month = 1; month <= 11; month++) {
            jest.clearAllMocks();
            Invoice.findOne.mockResolvedValue(null);
            const res = await runWith([yearlySubscription(paidAt)], addMonths(paidAt, month));

            expect(Invoice.create).not.toHaveBeenCalled();
            expect(res.invoicesGenerated).toBe(0);
        }
    });

    it('does not touch subscription status — AI stays available', async () => {
        const sub = yearlySubscription(new Date('2026-08-10T11:40:39.602Z'));

        await runWith([sub]);

        expect(sub.update).not.toHaveBeenCalled();
        expect(sub.status).toBe('active');
    });
});

describe('BILLING-YEARLY-003 — the annual boundary', () => {
    it('issues exactly one annual renewal invoice, typed as yearly', async () => {
        const paidAt = new Date('2026-08-10T11:40:39.602Z');
        const atBoundary = addYears(paidAt, 1);

        const res = await runWith([yearlySubscription(paidAt)], atBoundary);

        expect(Invoice.create).toHaveBeenCalledTimes(1);
        expect(Invoice.create).toHaveBeenCalledWith(expect.objectContaining({
            invoice_type: 'yearly_subscription',
        }), expect.anything());
        expect(res.invoicesGenerated).toBe(1);
    });

    it('bills the period the subscriber actually held — a year, not a month', async () => {
        const paidAt = new Date('2026-08-10T11:40:39.602Z');

        await runWith([yearlySubscription(paidAt)], addYears(paidAt, 1));

        const [[created]] = Invoice.create.mock.calls;
        expect(created.billing_period_start).toEqual(paidAt);
        expect(created.billing_period_end).toEqual(addYears(paidAt, 1));
    });
});

describe('BILLING-YEARLY-004 — annual amount', () => {
    it('charges the annual plan price, not the monthly price', async () => {
        const paidAt = new Date('2026-08-10T11:40:39.602Z');

        await runWith([yearlySubscription(paidAt)], addYears(paidAt, 1));

        const [[created]] = Invoice.create.mock.calls;
        expect(created.amount).toBe(YEARLY_PRICE);
        expect(created.base_amount).toBe(YEARLY_PRICE);
    });
});

describe('BILLING-YEARLY-005 — dunning waits for the entitlement to expire', () => {
    // The reconciler can only dun an invoice that exists. Before the annual
    // boundary the generator writes none, so there is nothing to fall past due
    // and nothing to suspend on.
    it('creates no dunnable invoice at any point inside the paid year', async () => {
        const paidAt = new Date('2026-08-10T11:40:39.602Z');
        const dayBeforeBoundary = new Date(addYears(paidAt, 1).getTime() - 1);

        const res = await runWith([yearlySubscription(paidAt)], dayBeforeBoundary);

        expect(Invoice.create).not.toHaveBeenCalled();
        expect(res.invoicesGenerated).toBe(0);
    });

    it('the invoice it writes at the boundary is dunnable, so a real lapse still suspends', () => {
        const { RECURRING_INVOICE_TYPES } = require('../../modules/subscription/subscription.plans');
        expect(RECURRING_INVOICE_TYPES).toContain('yearly_subscription');
    });
});

describe('BILLING-MONTHLY-REGRESSION — monthly subscriptions still renew monthly', () => {
    it('issues a monthly invoice once the month is up', async () => {
        const paidAt = new Date('2026-08-01T00:00:00.000Z');

        const res = await runWith([monthlySubscription(paidAt)], addMonths(paidAt, 1));

        expect(Invoice.create).toHaveBeenCalledTimes(1);
        expect(Invoice.create).toHaveBeenCalledWith(expect.objectContaining({
            invoice_type: 'monthly_subscription',
            amount: MONTHLY_PRICE,
        }), expect.anything());
        expect(res.invoicesGenerated).toBe(1);
    });

    it('does not bill a monthly subscriber mid-month', async () => {
        const paidAt = new Date('2026-08-01T00:00:00.000Z');

        await runWith([monthlySubscription(paidAt)], new Date('2026-08-15T01:00:00.000Z'));

        expect(Invoice.create).not.toHaveBeenCalled();
    });
});

describe('BILLING-IDEMPOTENCY — re-running the job for the same boundary', () => {
    it('does not write a second invoice when one already covers the period', async () => {
        const paidAt = new Date('2026-08-10T11:40:39.602Z');
        const atBoundary = addYears(paidAt, 1);

        // First run writes the invoice.
        const first = await runWith([yearlySubscription(paidAt)], atBoundary);
        expect(first.invoicesGenerated).toBe(1);

        // Second run for the same boundary finds it.
        jest.clearAllMocks();
        Invoice.findOne.mockResolvedValue({ id: 'inv-1', invoice_number: 'INV-1' });
        const second = await runWith([yearlySubscription(paidAt)], atBoundary);

        expect(Invoice.create).not.toHaveBeenCalled();
        expect(second.invoicesGenerated).toBe(0);
        expect(second.invoicesSkipped).toBe(1);
    });

    it('looks the invoice up by the period being billed, not the calendar month', async () => {
        const paidAt = new Date('2026-08-10T11:40:39.602Z');

        await runWith([yearlySubscription(paidAt)], addYears(paidAt, 1));

        expect(Invoice.findOne).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ billing_period_start: paidAt }),
        }));
    });
});

describe('subscriptions with no recorded period', () => {
    it('is billed rather than skipped — failing closed would stop invoicing a real customer', async () => {
        const sub = makeSubscription({
            current_period_start: null, current_period_end: null, next_billing_date: null,
        });

        const res = await runWith([sub]);

        expect(res.invoicesGenerated).toBe(1);
    });
});

describe('SHURU tier', () => {
    it('is never invoiced even once its period has lapsed', async () => {
        const sub = monthlySubscription(new Date('2026-01-01T00:00:00.000Z'), {
            plan_code: 'SHURU', plan_name: 'Shuru', plan_price: '0',
        });

        const res = await runWith([sub]);

        expect(Invoice.create).not.toHaveBeenCalled();
        expect(res.invoicesSkipped).toBe(1);
    });
});

describe('PARTNER delivery derivation', () => {
    it('uses delivered_at and records the flat rate band in invoice metadata', async () => {
        const sub = makeSubscription({
            plan_code: 'PARTNER',
            plan_name: 'Partner',
            plan_price: '0',
            billing_model: 'per_order',
            billing_cycle: 'per_order',
            next_billing_date: null,
        });
        Order.count.mockResolvedValueOnce(1000);

        await runWith([sub], new Date('2026-09-01T01:00:00.000Z'));

        expect(Order.count).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                order_status: 'delivered',
                delivered_at: expect.any(Object),
            }),
        }));
        expect(Invoice.create).toHaveBeenCalledWith(expect.objectContaining({
            amount: 12000,
            metadata: expect.objectContaining({
                delivered_orders: 1000,
                rate_band: '1000-2999',
                rate_bdt: 12,
                computed_total: 12000,
            }),
        }), expect.anything());
    });

    it('nets a settled-return credit into the next Partner invoice', async () => {
        const sub = makeSubscription({
            plan_code: 'PARTNER',
            plan_name: 'Partner',
            plan_price: '0',
            billing_model: 'per_order',
            billing_cycle: 'per_order',
            next_billing_date: null,
        });
        const adjustment = { amount_bdt: '15.00', update: jest.fn().mockResolvedValue(undefined) };
        Order.count.mockResolvedValueOnce(300);
        PartnerBillingAdjustment.findAll.mockResolvedValueOnce([adjustment]);

        await runWith([sub], new Date('2026-09-01T01:00:00.000Z'));

        expect(Invoice.create).toHaveBeenCalledWith(expect.objectContaining({
            amount: 4485,
            metadata: expect.objectContaining({ adjustment_credit: 15, computed_total: 4485 }),
        }), expect.anything());
        expect(adjustment.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'applied', invoice_id: 'inv-1',
        }), expect.anything());
    });
});

describe('daily reset/invoice handoff', () => {
    it('invoices the period that reset just advanced past', async () => {
        const sub = monthlySubscription(new Date('2026-02-28T12:00:00.000Z'), {
            current_period_start: new Date('2026-02-28T12:00:00.000Z'),
            current_period_end: new Date('2026-03-28T12:00:00.000Z'),
            next_billing_date: new Date('2026-03-28T12:00:00.000Z'),
            usage_reset_at: new Date('2026-01-31T12:00:00.000Z'),
        });

        await runWith([sub], new Date('2026-03-01T01:00:00.000Z'));

        expect(Invoice.create).toHaveBeenCalledWith(expect.objectContaining({
            billing_period_start: new Date('2026-01-31T12:00:00.000Z'),
            billing_period_end: new Date('2026-02-28T12:00:00.000Z'),
        }), expect.anything());
    });
});
