'use strict';

const paymentService = require('../payment.service');
const controller = require('../payment.controller');

jest.mock('../payment.service', () => ({
    savePaymentConfig: jest.fn(),
}));

describe('payment controller response serialization', () => {
    test('does not return decrypted payment credentials after save', async () => {
        paymentService.savePaymentConfig.mockResolvedValue({
            toJSON: () => ({
                id: 'config-1',
                gateway: 'self-mfs',
                is_enabled: true,
                credentials: { mfs_number: '01712345678' },
                config: {},
            }),
        });

        const req = {
            user: { shopId: 'shop-1', userId: 'user-1' },
            body: { gateway: 'self-mfs', is_enabled: true, credentials: { mfs_number: '01712345678' } },
        };
        const json = jest.fn();
        const res = { status: jest.fn(() => ({ json })) };
        const next = jest.fn();

        await controller.savePaymentConfig(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.not.objectContaining({ credentials: expect.anything() }),
        }));
    });
});
