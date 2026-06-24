/**
 * Invoice Payment Service — bKash settle + (re)activate (entities, bKash, and the
 * subscription service all mocked). Verifies the founder model: paying a recurring
 * invoice reactivates the AI; paying a one-off invoice just settles.
 */

jest.mock('../../entities', () => ({
    Subscription: { findOne: jest.fn() },
    Invoice: { findOne: jest.fn() },
    Shop: { findByPk: jest.fn() },
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

const { Subscription, Invoice } = require('../../entities');
const BangladeshPaymentService = require('../../payment/bangladesh-payment.service');
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
    status: overrides.status || 'pending',
    invoice_type: overrides.invoice_type || 'monthly_subscription',
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('completeInvoicePayment', () => {
    it('marks a recurring invoice paid and reactivates the subscription', async () => {
        const invoice = makeInvoice({ invoice_type: 'monthly_subscription' });
        Invoice.findOne.mockResolvedValueOnce(invoice);
        const sub = { id: 'sub-1', status: 'suspended' };
        Subscription.findOne.mockResolvedValueOnce(sub);
        bd.verifyBkashPayment.mockResolvedValueOnce({ success: true, status: 'completed', transaction_id: 'TRX9' });

        const res = await invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123');

        expect(invoice.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'paid', payment_method: 'bkash', transaction_id: 'TRX9' })
        );
        expect(subscriptionService.activateFromPaidInvoice).toHaveBeenCalledWith(sub);
        expect(res.status).toBe('paid');
        expect(res.transaction_id).toBe('TRX9');
    });

    it('settles a one-off invoice WITHOUT touching the subscription', async () => {
        const invoice = makeInvoice({ invoice_type: 'Conversation Pack (100 conversations)' });
        Invoice.findOne.mockResolvedValueOnce(invoice);
        bd.verifyBkashPayment.mockResolvedValueOnce({ success: true, status: 'completed', transaction_id: 'TRX1' });

        const res = await invoicePaymentService.completeInvoicePayment('shop-1', 'inv-1', 'PAY123');

        expect(invoice.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
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
        expect(invoice.update).not.toHaveBeenCalled();
        expect(subscriptionService.activateFromPaidInvoice).not.toHaveBeenCalled();
    });
});
