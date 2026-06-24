/**
 * FailedPaymentReconciler — 3-day-grace dunning logic (DB + email mocked).
 *
 * Policy under test (founder spec):
 *   - A recurring invoice (monthly_subscription / partner_per_order) past its due
 *     date → SUSPEND the subscription (AI auto-pauses) + send a dunning email.
 *   - A one-off invoice (proration / add-on) past due → reminder email only, never
 *     touches subscription status.
 */

jest.mock('../../modules/entities', () => ({
    Invoice: { findAll: jest.fn() },
    Subscription: {},
    Shop: {},
}));
jest.mock('../../utils/email.service', () => ({
    sendEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

const { Invoice } = require('../../modules/entities');
const emailService = require('../../utils/email.service');
const FailedPaymentReconciler = require('../failed-payment-reconciler');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const makeInvoice = (overrides = {}) => {
    const shopId = overrides.shop_id || 'shop-1';
    return {
        id: overrides.id || 'inv-1',
        invoice_number: overrides.invoice_number || 'INV-1',
        shop_id: shopId,
        amount: overrides.amount ?? 999,
        due_date: overrides.due_date || daysAgo(2),
        invoice_type: overrides.invoice_type || 'monthly_subscription',
        subscription: {
            id: 'sub-1',
            shop_id: shopId,
            status: 'active',
            update: jest.fn().mockResolvedValue(undefined),
        },
        shop: { id: shopId, name: 'Test Shop', email: overrides.email ?? 'owner@test.com' },
        ...overrides,
    };
};

beforeEach(() => jest.clearAllMocks());

describe('FailedPaymentReconciler.run', () => {
    it('suspends the subscription for a recurring invoice past its due date', async () => {
        const inv = makeInvoice({ invoice_type: 'monthly_subscription' });
        Invoice.findAll.mockResolvedValueOnce([inv]);

        const job = new FailedPaymentReconciler();
        const res = await job.run({ dryRun: false, runDate: new Date() });

        expect(inv.subscription.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'suspended' })
        );
        expect(res.subscriptionsSuspended).toBe(1);
        expect(res.invoicesOverdue).toBe(1);
        expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('suspends for a partner_per_order recurring invoice too', async () => {
        const inv = makeInvoice({ invoice_type: 'partner_per_order' });
        Invoice.findAll.mockResolvedValueOnce([inv]);

        const job = new FailedPaymentReconciler();
        const res = await job.run({ dryRun: false, runDate: new Date() });

        expect(inv.subscription.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'suspended' })
        );
        expect(res.subscriptionsSuspended).toBe(1);
    });

    it('only reminds (never suspends) for a one-off / discretionary invoice', async () => {
        const inv = makeInvoice({ invoice_type: 'Proration (upgrade to Growth)' });
        Invoice.findAll.mockResolvedValueOnce([inv]);

        const job = new FailedPaymentReconciler();
        const res = await job.run({ dryRun: false, runDate: new Date() });

        expect(inv.subscription.update).not.toHaveBeenCalled();
        expect(res.subscriptionsSuspended).toBe(0);
        expect(res.remindersSent).toBe(1);
        expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('dry-run makes no writes and sends no email', async () => {
        const inv = makeInvoice({ invoice_type: 'monthly_subscription' });
        Invoice.findAll.mockResolvedValueOnce([inv]);

        const job = new FailedPaymentReconciler();
        const res = await job.run({ dryRun: true, runDate: new Date() });

        expect(inv.subscription.update).not.toHaveBeenCalled();
        expect(emailService.sendEmail).not.toHaveBeenCalled();
        expect(res.invoicesOverdue).toBe(1); // counted, not applied
        expect(res.subscriptionsSuspended).toBe(1); // tallied as the action that *would* run
    });
});
