'use strict';

const mockPaymentTransaction = {
    findOne: jest.fn(),
    update: jest.fn(),
};

jest.mock('../../entities', () => ({
    PaymentTransaction: mockPaymentTransaction,
    Order: { findOne: jest.fn() },
    OrderSession: { findOne: jest.fn() },
}));
jest.mock('../../payment/bkash-merchant.service', () => ({}));
jest.mock('../../payment/payment.service', () => ({}));
jest.mock('../../order/order-session-standalone.service', () => ({}));

const controller = require('../payment-webhook.controller');

function response() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

describe('bKash payment webhook replay protection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('does not repeat fulfillment for an already-paid callback', async () => {
        const payment = {
            id: 'payment-1',
            status: 'paid',
            update: jest.fn(),
        };
        mockPaymentTransaction.findOne.mockResolvedValue(payment);
        const fulfillment = jest.spyOn(controller, 'processSuccessfulPayment');
        const res = response();

        await controller.handleBkashWebhook({
            body: {
                paymentID: 'gateway-payment-1',
                transactionStatus: 'Completed',
                trxID: 'trx-1',
                amount: '100.00',
            },
        }, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, duplicate: true });
        expect(mockPaymentTransaction.update).not.toHaveBeenCalled();
        expect(fulfillment).not.toHaveBeenCalled();
    });

    test('atomically claims a pending callback before fulfillment', async () => {
        const payment = {
            id: 'payment-1',
            amount: '100.00',
            status: 'pending',
            update: jest.fn().mockResolvedValue(undefined),
        };
        mockPaymentTransaction.findOne.mockResolvedValue(payment);
        mockPaymentTransaction.update.mockResolvedValue([1]);
        jest.spyOn(controller, 'processSuccessfulPayment').mockResolvedValue(undefined);
        const res = response();

        await controller.handleBkashWebhook({
            body: {
                paymentID: 'gateway-payment-1',
                transactionStatus: 'Completed',
                trxID: 'trx-1',
                amount: '100.00',
            },
        }, res);

        expect(mockPaymentTransaction.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'processing' }),
            expect.objectContaining({ where: expect.objectContaining({ id: 'payment-1' }) }),
        );
        expect(controller.processSuccessfulPayment).toHaveBeenCalledTimes(1);
        expect(payment.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('rejects a completed callback whose amount differs from the transaction', async () => {
        const payment = {
            id: 'payment-1',
            amount: '100.00',
            status: 'pending',
            update: jest.fn(),
        };
        mockPaymentTransaction.findOne.mockResolvedValue(payment);
        const fulfillment = jest.spyOn(controller, 'processSuccessfulPayment');
        const res = response();

        await controller.handleBkashWebhook({
            body: {
                paymentID: 'gateway-payment-1',
                transactionStatus: 'Completed',
                trxID: 'trx-1',
                amount: '99.00',
            },
        }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Payment amount mismatch' });
        expect(mockPaymentTransaction.update).not.toHaveBeenCalled();
        expect(fulfillment).not.toHaveBeenCalled();
    });

    test('losing the atomic claim does not run fulfillment', async () => {
        const payment = {
            id: 'payment-1',
            amount: '100.00',
            status: 'pending',
            update: jest.fn(),
        };
        mockPaymentTransaction.findOne.mockResolvedValue(payment);
        mockPaymentTransaction.update.mockResolvedValue([0]);
        const fulfillment = jest.spyOn(controller, 'processSuccessfulPayment');
        const res = response();

        await controller.handleBkashWebhook({
            body: {
                paymentID: 'gateway-payment-1',
                transactionStatus: 'Completed',
                trxID: 'trx-1',
                amount: '100.00',
            },
        }, res);

        expect(res.status).toHaveBeenCalledWith(202);
        expect(res.json).toHaveBeenCalledWith({ success: true, pending: true });
        expect(fulfillment).not.toHaveBeenCalled();
    });

    test('a processing callback remains pending and cannot repeat fulfillment', async () => {
        mockPaymentTransaction.findOne.mockResolvedValue({
            id: 'payment-1',
            status: 'processing',
            updated_at: new Date(Date.now() - 60 * 60 * 1000),
            update: jest.fn(),
        });
        const fulfillment = jest.spyOn(controller, 'processSuccessfulPayment');
        const res = response();

        await controller.handleBkashWebhook({
            body: {
                paymentID: 'gateway-payment-1',
                transactionStatus: 'Completed',
                trxID: 'trx-1',
                amount: '100.00',
            },
        }, res);

        expect(res.status).toHaveBeenCalledWith(202);
        expect(res.json).toHaveBeenCalledWith({ success: true, pending: true });
        expect(mockPaymentTransaction.update).not.toHaveBeenCalled();
        expect(fulfillment).not.toHaveBeenCalled();
    });

    test('rejects an invalid completed transition', async () => {
        mockPaymentTransaction.findOne.mockResolvedValue({
            id: 'payment-1',
            status: 'rejected',
            update: jest.fn(),
        });
        const res = response();

        await controller.handleBkashWebhook({
            body: {
                paymentID: 'gateway-payment-1',
                transactionStatus: 'Completed',
            },
        }, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid payment state transition' });
    });
});
