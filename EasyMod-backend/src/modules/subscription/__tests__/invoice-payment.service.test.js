/**
 * Invoice Payment Service — bKash settle + (re)activate (entities, bKash, and the
 * subscription service all mocked). Verifies the founder model: paying a recurring
 * invoice reactivates the AI; paying a one-off invoice just settles.
 */

jest.mock('../../entities', () => ({
    Subscription: { findOne: jest.fn() },
    Invoice: { findOne: jest.fn(), update: jest.fn() },
    Shop: { findByPk: jest.fn() },
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        getDialect: () => 'postgres',
        query: jest.fn(),
        transaction: jest.fn(async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } })),
    },
}));
jest.mock('../../payment/bangladesh-payment.service', () =>
    jest.fn().mockImplementation(() => ({
        initializeBkashPayment: jest.fn(),
        verifyBkashPayment: jest.fn(),
    }))
);
jest.mock('../subscription.service', () => ({
    activateFromPaidInvoice: jest.fn().mockResolvedValue(undefined),
    ensureRenewalInvoice: jest.fn(),
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { Subscription, Invoice, Shop } = require('../../entities');
const BangladeshPaymentService = require('../../payment/bangladesh-payment.service');
const { sequelize } = require('../../../utils/database/database-setup');
const subscriptionService = require('../subscription.service');
const invoicePaymentService = require('../invoice-payment.service');

// The service constructs one bKash client at module load — grab that instance.
const bd = BangladeshPaymentService.mock.results[0].value;

const makeInvoice = (overrides = {}) => ({
    id: overrides.id || 'inv-1',
    shop_id: overrides.shop_id || 'shop-1',
    subscription_id: overrides.subscription_id || 'sub-1',
    invoice_number: overrides.invoice_number || 'INV-1',
    amount: overrides.amount ?? 1149,
    payment_id: overrides.payment_id || 'PAY123',
    status: overrides.status || 'pending',
    invoice_type: overrides.invoice_type || 'monthly_subscription',
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    sequelize.query.mockResolvedValue([[], { rowCount: 1 }]);
});

describe('completeInvoicePayment', () => {
    it('marks a recurring invoice paid and reactivates the subscription', async () => {
        const invoice = makeInvoice({ invoice_type: 'monthly_subscription' });
        Invoice.findOne.mockResolvedValueOnce(invoice).mockResolvedValueOnce(invoice);
        const sub = { id: 'sub-1', status: 'suspended' };
        Subscription.findOne.mockResolvedValueOnce(sub);
        bd.verifyBkashPayment.mockResolvedValueOnce({ success: true, status: 'completed', transaction_id: 'TRX9', amount: '1149.00', currency: 'BDT', merchant_invoice: 'INV-1' });

        const res = await invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123');

        expect(sequelize.query).toHaveBeenCalledWith(
            expect.stringMatching(/UPDATE invoices[\s\S]*status='paid'/),
            expect.objectContaining({ replacements: expect.objectContaining({ paymentId: 'PAY123' }) })
        );
        expect(subscriptionService.activateFromPaidInvoice).toHaveBeenCalledWith(
            sub,
            expect.objectContaining({ transaction: expect.anything() }),
        );
        expect(res.status).toBe('paid');
        expect(res.transaction_id).toBe('TRX9');
    });

    it('settles a one-off invoice WITHOUT touching the subscription', async () => {
        const invoice = makeInvoice({ invoice_type: 'add_on' });
        Invoice.findOne.mockResolvedValueOnce(invoice).mockResolvedValueOnce(invoice);
        bd.verifyBkashPayment.mockResolvedValueOnce({ success: true, status: 'completed', transaction_id: 'TRX1', amount: '1149', currency: 'BDT', merchant_invoice: 'INV-1' });

        const res = await invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123');

        expect(subscriptionService.activateFromPaidInvoice).not.toHaveBeenCalled();
        expect(res.subscription_status).toBeNull();
    });

    it('is idempotent — an already-paid invoice short-circuits without re-verifying', async () => {
        Invoice.findOne.mockResolvedValueOnce(makeInvoice({ status: 'paid' }));

        const res = await invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123');

        expect(res.already_paid).toBe(true);
        expect(bd.verifyBkashPayment).not.toHaveBeenCalled();
        expect(subscriptionService.activateFromPaidInvoice).not.toHaveBeenCalled();
    });

    it('throws (and does not settle) when bKash verification fails', async () => {
        const invoice = makeInvoice();
        Invoice.findOne.mockResolvedValueOnce(invoice);
        bd.verifyBkashPayment.mockResolvedValueOnce({ success: false, status: 'failed', message: 'declined' });

        await expect(
            invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123')
        ).rejects.toThrow();
        expect(sequelize.query).not.toHaveBeenCalled();
        expect(subscriptionService.activateFromPaidInvoice).not.toHaveBeenCalled();
    });

    it('rejects a forged payment ID before gateway verification', async () => {
        Invoice.findOne.mockResolvedValueOnce(makeInvoice({ payment_id: 'PAY-REAL' }));

        await expect(
            invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY-FORGED')
        ).rejects.toMatchObject({ status: 403 });
        expect(bd.verifyBkashPayment).not.toHaveBeenCalled();
        expect(sequelize.query).not.toHaveBeenCalled();
    });

    it('does not run settlement side effects when the atomic claim loses a race', async () => {
        const invoice = makeInvoice();
        Invoice.findOne
            .mockResolvedValueOnce(invoice)
            .mockResolvedValueOnce(invoice)
            .mockResolvedValueOnce({ ...invoice, status: 'paid' });
        Subscription.findOne.mockResolvedValueOnce({ id: 'sub-1', status: 'active', plan_code: 'GROWTH' });
        bd.verifyBkashPayment.mockResolvedValueOnce({ success: true, status: 'completed', transaction_id: 'TRX9', amount: '1149', currency: 'BDT', merchant_invoice: 'INV-1' });
        sequelize.query.mockResolvedValueOnce([[], { rowCount: 0 }]);

        const result = await invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123');

        expect(result.already_paid).toBe(true);
        expect(subscriptionService.activateFromPaidInvoice).not.toHaveBeenCalled();
    });

    it('rejects a payment when a concurrent return changes the invoice amount', async () => {
        const invoice = makeInvoice({ amount: 1149 });
        Invoice.findOne
            .mockResolvedValueOnce(invoice)
            .mockResolvedValueOnce({ ...invoice, amount: 999 });
        bd.verifyBkashPayment.mockResolvedValueOnce({
            success: true,
            status: 'completed',
            transaction_id: 'TRX9',
            amount: '1149.00',
            currency: 'BDT',
            merchant_invoice: 'INV-1',
        });

        await expect(invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123'))
            .rejects.toMatchObject({ status: 409, code: 'INVOICE_AMOUNT_CHANGED' });
        expect(subscriptionService.activateFromPaidInvoice).not.toHaveBeenCalled();
    });

    it('rejects a recurring invoice whose plan snapshot is stale', async () => {
        const invoice = makeInvoice({ metadata: { plan_code: 'GROWTH' } });
        Invoice.findOne
            .mockResolvedValueOnce(invoice)
            .mockResolvedValueOnce(invoice);
        Subscription.findOne.mockResolvedValueOnce({ id: 'sub-1', plan_code: 'PARTNER', status: 'active' });
        bd.verifyBkashPayment.mockResolvedValueOnce({
            success: true,
            status: 'completed',
            transaction_id: 'TRX9',
            amount: '1149.00',
            currency: 'BDT',
            merchant_invoice: 'INV-1',
        });

        await expect(invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123'))
            .rejects.toMatchObject({ status: 409, code: 'STALE_PLAN_INVOICE' });
        expect(sequelize.query).not.toHaveBeenCalled();
    });
});

describe('initiateInvoicePayment', () => {
    it('leases an invoice before creating a gateway payment', async () => {
        const invoice = { ...makeInvoice(), payment_id: null, bkash_url: null };
        Invoice.findOne.mockResolvedValueOnce(invoice);
        Shop.findByPk.mockResolvedValueOnce({ name: 'Shop Owner', phone: '01711111111' });
        bd.initializeBkashPayment.mockResolvedValueOnce({
            success: true,
            payment_id: 'PAY456',
            bkash_url: 'https://bkash.example/PAY456',
        });

        const result = await invoicePaymentService.initiateInvoicePayment('shop-1', 'inv-1', {
            callbackUrl: 'https://app.example/subscription',
        });

        expect(result.payment_id).toBe('PAY456');
        expect(sequelize.query.mock.calls[0][0]).toMatch(/checkout_lease_id/);
        expect(sequelize.query.mock.calls[1][0]).toMatch(/checkout_lease_id=NULL/);
    });

    it('returns the persisted checkout instead of creating a second gateway payment', async () => {
        const invoice = makeInvoice({ bkash_url: 'https://bkash.example/PAY123' });
        Invoice.findOne.mockResolvedValueOnce(invoice);

        const result = await invoicePaymentService.initiateInvoicePayment('shop-1', 'inv-1', {
            callbackUrl: 'https://app.example/subscription',
        });

        expect(result).toEqual(expect.objectContaining({ payment_id: 'PAY123', bkash_url: 'https://bkash.example/PAY123' }));
        expect(bd.initializeBkashPayment).not.toHaveBeenCalled();
    });
});

describe('cancelInvoicePayment', () => {
    it('releases the matching checkout binding so the invoice can be retried', async () => {
        const invoice = makeInvoice({ payment_id: 'PAY-CANCEL', bkash_url: 'https://bkash.example/PAY-CANCEL' });
        Invoice.findOne.mockResolvedValueOnce(invoice);
        Invoice.update.mockResolvedValueOnce([1]);

        const result = await invoicePaymentService.cancelInvoicePayment('shop-1', 'inv-1', 'PAY-CANCEL');

        expect(result).toEqual(expect.objectContaining({ success: true, invoice_id: 'inv-1', payment_id: null }));
        expect(Invoice.update).toHaveBeenCalledWith(
            expect.objectContaining({ payment_id: null, bkash_url: null }),
            expect.objectContaining({ where: expect.objectContaining({ payment_id: 'PAY-CANCEL' }) }),
        );
    });

    it('does not release a checkout bound to a different payment ID', async () => {
        Invoice.findOne.mockResolvedValueOnce(makeInvoice({ payment_id: 'PAY-REAL' }));

        await expect(invoicePaymentService.cancelInvoicePayment('shop-1', 'inv-1', 'PAY-FORGED'))
            .rejects.toMatchObject({ status: 403 });
        expect(Invoice.update).not.toHaveBeenCalled();
    });
});
