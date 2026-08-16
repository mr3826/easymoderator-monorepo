'use strict';

const mockChat = jest.fn();
const mockSafeFetchMedia = jest.fn();
const mockTrxIDLogFindOne = jest.fn();
const mockTrxIDLogCreate = jest.fn();

jest.mock('../../../utils/safe-media-fetch', () => ({
    safeFetchMedia: mockSafeFetchMedia,
}));
jest.mock('../../ai/llm.service', () => ({ chat: mockChat }));
jest.mock('../../entities', () => ({
    TrxIDLog: {
        findOne: mockTrxIDLogFindOne,
        create: mockTrxIDLogCreate,
    },
}));

const service = require('../self-mfs-handler.service');

describe('self-MFS TrxIDLog audit-write failure — fail closed', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSafeFetchMedia.mockResolvedValue({ buffer: Buffer.from('safe-image'), mimeType: 'image/png' });
        mockTrxIDLogFindOne.mockResolvedValue(null); // no duplicate
        mockChat.mockResolvedValue({
            text: JSON.stringify({
                trx_id: 'ABC123XYZ',
                amount: 500,
                sender_phone: null,
                receiver_phone: '01712345678',
                mfs_type: 'bkash',
                status: 'Successful',
                confidence: 0.95,
            }),
        });
    });

    test('generic DB error writing TrxIDLog fails closed (verified:false), not open', async () => {
        mockTrxIDLogCreate.mockRejectedValue(new Error('connection terminated unexpectedly'));

        const result = await service.verifyPaymentScreenshot({
            shopId: 'shop-1',
            orderId: 'order-1',
            imageUrl: 'https://scontent.xx.fbcdn.net/synthetic.png',
            expectedAmount: 500,
            expectedReceiver: '01712345678',
            mfsType: 'bkash',
        });

        expect(result.verified).toBe(false);
        expect(result.trxId).toBe('ABC123XYZ');
        expect(result.reason).toEqual(expect.any(String));
        // Must be distinct from the duplicate-TrxID message.
        expect(result.reason).not.toMatch(/আগেই ব্যবহার হয়েছে/);
    });

    test('duplicate-constraint error still returns the duplicate message (unchanged behavior)', async () => {
        const dupErr = new Error('duplicate key value violates unique constraint');
        dupErr.name = 'SequelizeUniqueConstraintError';
        mockTrxIDLogCreate.mockRejectedValue(dupErr);

        const result = await service.verifyPaymentScreenshot({
            shopId: 'shop-1',
            orderId: 'order-1',
            imageUrl: 'https://scontent.xx.fbcdn.net/synthetic.png',
            expectedAmount: 500,
            expectedReceiver: '01712345678',
            mfsType: 'bkash',
        });

        expect(result.verified).toBe(false);
        expect(result.reason).toMatch(/আগেই ব্যবহার হয়েছে/);
    });

    test('successful TrxIDLog write still verifies the payment', async () => {
        mockTrxIDLogCreate.mockResolvedValue({ id: 'log-1' });

        const result = await service.verifyPaymentScreenshot({
            shopId: 'shop-1',
            orderId: 'order-1',
            imageUrl: 'https://scontent.xx.fbcdn.net/synthetic.png',
            expectedAmount: 500,
            expectedReceiver: '01712345678',
            mfsType: 'bkash',
        });

        expect(result.verified).toBe(true);
    });

    test('unsafe/unavailable media fetch fails closed before OCR or audit write', async () => {
        mockSafeFetchMedia.mockRejectedValue(new Error('blocked private address'));

        const result = await service.verifyPaymentScreenshot({
            shopId: 'shop-1',
            orderId: 'order-1',
            imageUrl: 'https://scontent.xx.fbcdn.net/synthetic.png',
            expectedAmount: 500,
            expectedReceiver: '01712345678',
            mfsType: 'bkash',
        });

        expect(result.verified).toBe(false);
        expect(mockChat).not.toHaveBeenCalled();
        expect(mockTrxIDLogCreate).not.toHaveBeenCalled();
    });
});
