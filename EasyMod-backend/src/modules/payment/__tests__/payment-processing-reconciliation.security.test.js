'use strict';

const mockFindAndCountAll = jest.fn();
const mockOpsAlert = jest.fn();

jest.mock('../../entities', () => ({
    PaymentTransaction: { findAndCountAll: mockFindAndCountAll },
}));
jest.mock('../../../utils/ops-alert', () => ({ opsAlert: mockOpsAlert }));

const service = require('../payment-processing-reconciliation.service');

describe('stale payment processing reconciliation report', () => {
    beforeEach(() => jest.clearAllMocks());

    test('identifies stale processing work by age without mutating or replaying it', async () => {
        const now = new Date('2026-07-23T10:00:00.000Z');
        const updatedAt = new Date('2026-07-23T09:00:00.000Z');
        mockFindAndCountAll.mockResolvedValue({
            count: 1,
            rows: [{
                id: 'payment-1',
                shop_id: 'shop-1',
                order_id: 'order-1',
                payment_gateway: 'bkash',
                status: 'processing',
                updated_at: updatedAt,
            }],
        });

        const report = await service.getStalePaymentProcessingReport({
            olderThanMinutes: 15,
            limit: 50,
            now,
        });

        expect(report).toEqual({
            thresholdMinutes: 15,
            generatedAt: now,
            total: 1,
            items: [{
                paymentId: 'payment-1',
                shopId: 'shop-1',
                orderId: 'order-1',
                gateway: 'bkash',
                status: 'processing',
                updatedAt,
                ageMinutes: 60,
            }],
        });
        expect(mockFindAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: 'processing',
                updated_at: expect.any(Object),
            }),
            attributes: [
                'id',
                'shop_id',
                'order_id',
                'payment_gateway',
                'status',
                'updated_at',
            ],
        }));
        expect(mockOpsAlert).toHaveBeenCalledWith(
            'Stale payment processing requires reconciliation',
            expect.objectContaining({
                context: {
                    staleCount: 1,
                    thresholdMinutes: 15,
                    oldestAgeMinutes: 60,
                },
            }),
        );
    });

    test('empty report does not send an alert', async () => {
        mockFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });

        await expect(service.getStalePaymentProcessingReport({
            now: new Date('2026-07-23T10:00:00.000Z'),
        })).resolves.toMatchObject({ total: 0, items: [] });
        expect(mockOpsAlert).not.toHaveBeenCalled();
    });
});
