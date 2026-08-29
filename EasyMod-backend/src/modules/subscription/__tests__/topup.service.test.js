'use strict';

jest.mock('../../entities', () => ({
    Subscription: { findOne: jest.fn() },
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        QueryTypes: { SELECT: 'SELECT' },
        getDialect: () => 'postgres',
        query: jest.fn(),
        transaction: jest.fn(async (callback) => callback({ id: 'tx-1' })),
    },
}));
jest.mock('../../payment/bangladesh-payment.service', () => jest.fn().mockImplementation(() => ({
    initializeBkashPayment: jest.fn(),
    verifyBkashPayment: jest.fn(),
})));
jest.mock('../invoice.service', () => ({ generateTopupInvoice: jest.fn() }));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { Subscription } = require('../../entities');
const { sequelize } = require('../../../utils/database/database-setup');
const BangladeshPaymentService = require('../../payment/bangladesh-payment.service');
const invoiceService = require('../invoice.service');
const topupService = require('../topup.service');

const bd = BangladeshPaymentService.mock.results[0].value;

const pendingTopup = (overrides = {}) => ({
    id: 'topup-1',
    shop_id: 'shop-1',
    pack_code: 'PACK_100',
    pack_conversations: 100,
    amount_bdt: '250.00',
    status: 'pending',
    bkash_payment_id: 'PAY-1',
    invoice_number: 'TU-202608-ABC123',
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    sequelize.query.mockResolvedValue([[], { rowCount: 1 }]);
    Subscription.findOne.mockResolvedValue({ shop_name: 'Test Shop' });
    invoiceService.generateTopupInvoice.mockResolvedValue('/invoices/topup-1.pdf');
});

describe('top-up catalog and plan guard', () => {
    it('lists only the current PACK catalog', () => {
        expect(topupService.getTopupPacks()).toEqual([
            { code: 'PACK_100', conversations: 100, priceBdt: 250 },
            { code: 'PACK_300', conversations: 300, priceBdt: 500 },
            { code: 'PACK_700', conversations: 700, priceBdt: 1000 },
        ]);
    });

    it.each(['SHURU', 'PARTNER'])('rejects initiation for %s', async (planCode) => {
        Subscription.findOne.mockResolvedValueOnce({ plan_code: planCode });

        await expect(topupService.initiateTopup('shop-1', 'PACK_100', {
            phone: '01711111111', name: 'Owner', callbackUrl: 'https://app.example/subscription',
        })).rejects.toMatchObject({ status: 403 });
        expect(sequelize.query).not.toHaveBeenCalled();
    });

    it('rejects retired codes even for Growth', async () => {
        Subscription.findOne.mockResolvedValueOnce({ plan_code: 'GROWTH' });

        await expect(topupService.initiateTopup('shop-1', 'TOPUP_100', {
            phone: '01711111111', name: 'Owner', callbackUrl: 'https://app.example/subscription',
        })).rejects.toMatchObject({ status: 400 });
    });

    it('requires an idempotency key before starting a Growth checkout', async () => {
        Subscription.findOne.mockResolvedValueOnce({ plan_code: 'GROWTH' });

        await expect(topupService.initiateTopup('shop-1', 'PACK_100', {
            phone: '01711111111', name: 'Owner', callbackUrl: 'https://app.example/subscription',
        })).rejects.toMatchObject({ status: 400 });
        expect(bd.initializeBkashPayment).not.toHaveBeenCalled();
    });

    it('reuses an existing pending checkout for the same idempotency key', async () => {
        Subscription.findOne.mockResolvedValueOnce({ plan_code: 'GROWTH' });
        sequelize.query.mockResolvedValueOnce([{
            id: 'topup-1',
            pack_code: 'PACK_100',
            bkash_payment_id: 'PAY-1',
            bkash_url: 'https://bkash.example/PAY-1',
            invoice_number: 'TU-202608-ABC123',
            status: 'pending',
        }]);

        const result = await topupService.initiateTopup('shop-1', 'PACK_100', {
            phone: '01711111111', name: 'Owner', callbackUrl: 'https://app.example/subscription', idempotencyKey: 'key-1',
        });

        expect(result).toEqual(expect.objectContaining({ topup_id: 'topup-1', payment_id: 'PAY-1' }));
        expect(bd.initializeBkashPayment).not.toHaveBeenCalled();
    });

    it('reserves the idempotency key before calling bKash', async () => {
        Subscription.findOne.mockResolvedValueOnce({ plan_code: 'GROWTH' });
        sequelize.query
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([[], { rowCount: 1 }])
            .mockResolvedValueOnce([[], { rowCount: 1 }]);
        bd.initializeBkashPayment.mockResolvedValueOnce({
            success: true, payment_id: 'PAY-NEW', bkash_url: 'https://bkash.example/PAY-NEW',
        });

        const result = await topupService.initiateTopup('shop-1', 'PACK_100', {
            phone: '01711111111', name: 'Owner', callbackUrl: 'https://app.example/subscription', idempotencyKey: 'key-2',
        });

        expect(result.payment_id).toBe('PAY-NEW');
        expect(sequelize.query.mock.calls[1][0]).toMatch(/idempotency_key/);
        expect(bd.initializeBkashPayment).toHaveBeenCalledTimes(1);
    });
});

describe('completeTopup', () => {
    it('binds the gateway payment, checks amount, and credits atomically', async () => {
        sequelize.query
            .mockResolvedValueOnce([pendingTopup()])
            .mockResolvedValueOnce([[], { rowCount: 1 }])
            .mockResolvedValueOnce([[], { rowCount: 1 }])
            .mockResolvedValueOnce([[], { rowCount: 1 }]);
        bd.verifyBkashPayment.mockResolvedValueOnce({
            success: true, status: 'completed', amount: '250', transaction_id: 'TRX-1', currency: 'BDT', merchant_invoice: 'TU-202608-ABC123',
        });

        const result = await topupService.completeTopup('shop-1', 'topup-1', 'PAY-1');

        expect(result).toEqual(expect.objectContaining({ success: true, conversations_added: 100 }));
        expect(sequelize.query).toHaveBeenCalledWith(
            expect.stringMatching(/topup_balance = COALESCE\(topup_balance, 0\) \+ :add/),
            expect.objectContaining({ replacements: expect.objectContaining({ add: 100, shopId: 'shop-1' }) }),
        );
    });

    it('rejects a forged payment ID without contacting bKash', async () => {
        sequelize.query.mockResolvedValueOnce([pendingTopup()]);

        await expect(topupService.completeTopup('shop-1', 'topup-1', 'PAY-FORGED'))
            .rejects.toMatchObject({ status: 403 });
        expect(bd.verifyBkashPayment).not.toHaveBeenCalled();
        expect(sequelize.query).toHaveBeenCalledTimes(1);
    });

    it('treats a lost atomic claim as a handled duplicate', async () => {
        sequelize.query
            .mockResolvedValueOnce([pendingTopup()])
            .mockResolvedValueOnce([[], { rowCount: 0 }]);
        bd.verifyBkashPayment.mockResolvedValueOnce({
            success: true, status: 'completed', amount: '250', transaction_id: 'TRX-1', currency: 'BDT', merchant_invoice: 'TU-202608-ABC123',
        });

        const result = await topupService.completeTopup('shop-1', 'topup-1', 'PAY-1');

        expect(result).toEqual({ success: true, already_completed: true, invoice_url: undefined });
        expect(bd.verifyBkashPayment).toHaveBeenCalledWith('PAY-1');
    });
});
