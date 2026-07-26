'use strict';

const mockDeliveryTracking = {
    findOne: jest.fn(),
};
const mockOrder = {};
const mockShop = {};

jest.mock('../../entities', () => ({
    DeliveryTracking: mockDeliveryTracking,
    Order: mockOrder,
    Shop: mockShop,
}));
jest.mock('../delivery.service', () => ({ getDeliveryStatus: jest.fn() }));
jest.mock('../../rto-shield/rto-shield.service', () => ({
    trackDeliveryOutcome: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const service = require('../delivery-tracking.service');

describe('delivery tracking tenant and replay safeguards', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('a stale courier callback cannot regress a terminal delivery state', async () => {
        const tracking = {
            id: 'tracking-1',
            current_status: 'delivered',
            order: { shop_id: 'shop-1', update: jest.fn() },
            update: jest.fn(),
        };
        mockDeliveryTracking.findOne.mockResolvedValue(tracking);

        const result = await service.handleDeliveryWebhook('pathao', 'CN-1', {
            status: 'IN_TRANSIT',
        });

        expect(result).toMatchObject({
            success: true,
            ignored: true,
            message: 'Terminal status preserved',
        });
        expect(tracking.update).not.toHaveBeenCalled();
        expect(tracking.order.update).not.toHaveBeenCalled();
    });

    test('order tracking lookup binds the tenant through the real Order foreign key', async () => {
        mockDeliveryTracking.findOne.mockResolvedValue({ id: 'tracking-1' });

        await service.getTrackingByOrderId('order-1', 'shop-1');

        expect(mockDeliveryTracking.findOne).toHaveBeenCalledWith({
            where: { order_id: 'order-1' },
            include: [{
                model: mockOrder,
                as: 'order',
                attributes: ['order_number', 'customer_name', 'customer_phone', 'total'],
                where: { shop_id: 'shop-1' },
                required: true,
            }],
        });
    });

    test('tracking-history lookup cannot select a tracking row from another shop', async () => {
        mockDeliveryTracking.findOne.mockResolvedValue({
            current_status: 'in_transit',
            tracking_number: 'CN-1',
            provider: 'pathao',
        });

        await service.getTrackingHistory('tracking-1', 'shop-1');

        expect(mockDeliveryTracking.findOne).toHaveBeenCalledWith({
            where: { id: 'tracking-1' },
            include: [{
                model: mockOrder,
                as: 'order',
                attributes: ['id'],
                where: { shop_id: 'shop-1' },
                required: true,
            }],
        });
    });
});
