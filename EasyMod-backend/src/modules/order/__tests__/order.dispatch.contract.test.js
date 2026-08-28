'use strict';

const mockOrder = {};
const mockCourierDispatch = {
    findOrCreate: jest.fn(),
};

jest.mock('../../entities', () => ({
    Order: mockOrder,
    OrderItem: {},
    Product: {},
    Customer: {},
    UserShop: {},
    OrderReturn: {},
    CourierDispatch: mockCourierDispatch,
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(),
        query: jest.fn(),
        getDialect: jest.fn(),
    },
}));
jest.mock('../../delivery/delivery.service', () => ({
    resolveAiDefaultProvider: jest.fn(),
    createDeliveryOrder: jest.fn(),
}));
jest.mock('../order-session-standalone.service', () => ({
    persistDeliveryResult: jest.fn(),
}));
jest.mock('../../notification/merchant-notification.service', () => ({
    notifyShop: jest.fn().mockResolvedValue({ queued: true }),
}));
jest.mock('../../notification/notification-events', () => ({
    NOTIFICATION_EVENTS: {
        COURIER_SETUP_REQUIRED: 'courier_setup_required',
        COURIER_BOOKING_FAILED: 'courier_booking_failed',
    },
}));

const orderService = require('../order.service');
const deliveryService = require('../../delivery/delivery.service');
const sessionService = require('../order-session-standalone.service');
const merchantNotificationService = require('../../notification/merchant-notification.service');

const makeOrder = () => {
    const order = {
        id: 'order-1',
        shop_id: 'shop-1',
        order_number: 'ORD-REAL-0007',
        order_status: 'confirmed',
        fulfillment_status: 'unfulfilled',
        customer_name: 'Rahim',
        customer_phone: '01711111111',
        delivery_address: {
            street_address: 'Road 1',
            upazila: 'Dhanmondi',
            district: 'Dhaka',
        },
        total: '1250.00',
        items: [{ name: 'Red Saree', quantity: 2 }],
        update: jest.fn(async function update(values) {
            Object.assign(this, values);
        }),
    };
    return order;
};

describe('canonical courier booking', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        deliveryService.resolveAiDefaultProvider.mockResolvedValue({
            blocked: false,
            provider: 'pathao',
            pickup: { provider_store_id: 'store-1' },
        });
        deliveryService.createDeliveryOrder.mockResolvedValue({
            provider: 'pathao',
            consignment_id: 'CN-1',
            tracking_code: 'TRK-1',
            status: 'pending',
        });
        sessionService.persistDeliveryResult.mockResolvedValue(undefined);
        mockCourierDispatch.findOrCreate.mockResolvedValue([{
            status: 'PENDING',
            update: jest.fn().mockResolvedValue(undefined),
        }, true]);
    });

    it('claims the actual provider and persists the canonical order payload', async () => {
        const order = makeOrder();

        const result = await orderService.bookForOrder(order, {
            shopId: 'shop-1',
        });

        expect(deliveryService.resolveAiDefaultProvider).toHaveBeenCalledWith('shop-1');
        expect(mockCourierDispatch.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
            where: { shop_id: 'shop-1', order_id: 'order-1', provider: 'pathao' },
            defaults: expect.objectContaining({ status: 'PENDING' }),
        }));
        expect(deliveryService.createDeliveryOrder).toHaveBeenCalledWith(
            'shop-1',
            expect.objectContaining({
                order_number: 'ORD-REAL-0007',
                customer_name: 'Rahim',
                customer_phone: '01711111111',
                delivery_address: 'Road 1, Dhanmondi, Dhaka',
                total: 1250,
                item_quantity: 2,
                store_id: 'store-1',
                pickup_store_id: 'store-1',
            }),
            'pathao'
        );
        expect(deliveryService.createDeliveryOrder.mock.calls[0][1]).not.toHaveProperty('delivery_area');
        expect(deliveryService.createDeliveryOrder.mock.calls[0][1]).not.toHaveProperty('delivery_area_id');
        expect(sessionService.persistDeliveryResult).toHaveBeenCalledWith(order, expect.objectContaining({
            provider: 'pathao',
            tracking_code: 'TRK-1',
        }));
        expect(result).toEqual(expect.objectContaining({ tracking_code: 'TRK-1' }));
        expect(order.order_status).toBe('confirmed');
        expect(order.fulfillment_status).toBe('unfulfilled');
    });

    it('marks setup required without claiming or calling a provider when readiness blocks booking', async () => {
        const order = makeOrder();
        deliveryService.resolveAiDefaultProvider.mockResolvedValue({
            blocked: true,
            provider: 'pathao',
            reason: 'COURIER_SETUP_REQUIRED',
            missing: ['pickup_location_configured'],
        });

        const result = await orderService.bookForOrder(order, {
            shopId: 'shop-1',
            requireAiDefault: true,
        });

        expect(result).toMatchObject({
            blocked: true,
            status: 'courier_setup_required',
            provider: 'pathao',
            missing: ['pickup_location_configured'],
        });
        expect(mockCourierDispatch.findOrCreate).not.toHaveBeenCalled();
        expect(deliveryService.createDeliveryOrder).not.toHaveBeenCalled();
        expect(order.update).toHaveBeenCalledWith({ delivery_status: 'courier_setup_required' });
        expect(order.order_status).toBe('confirmed');
        expect(order.fulfillment_status).toBe('unfulfilled');
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            'shop-1',
            'courier_setup_required',
            expect.objectContaining({ status: 'courier_setup_required' }),
            expect.objectContaining({ dedupeKey: 'order-1:courier_setup_required' })
        );
    });

    it('marks a definite provider validation rejection failed instead of indeterminate', async () => {
        const order = makeOrder();
        const dispatchRecord = {
            status: 'PENDING',
            update: jest.fn().mockResolvedValue(undefined),
        };
        mockCourierDispatch.findOrCreate.mockResolvedValueOnce([dispatchRecord, true]);
        deliveryService.createDeliveryOrder.mockRejectedValueOnce(Object.assign(
            new Error('Invalid pickup address'),
            { status: 400, statusCode: 400 },
        ));

        const result = await orderService.bookForOrder(order, {
            shopId: 'shop-1',
            throwOnError: false,
        });

        expect(result).toMatchObject({
            failed: true,
            status: 'dispatch_failed',
            provider: 'pathao',
        });
        expect(dispatchRecord.update).toHaveBeenCalledWith({
            status: 'FAILED',
            error: 'Invalid pickup address',
        });
        expect(order.update).not.toHaveBeenCalledWith({ delivery_status: 'dispatch_indeterminate' });
    });
});
