'use strict';

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: { define: jest.fn(() => ({})), transaction: jest.fn() },
}));
jest.mock('../order.service', () => ({ createOrderInternal: jest.fn() }));
jest.mock('../../product/product-search.service', () => ({ checkStock: jest.fn() }));
jest.mock('../../payment/self-mfs-handler.service', () => ({ verifyPaymentScreenshot: jest.fn() }));
jest.mock('../../shop/shop-bd-settings', () => ({ getBdSettings: jest.fn(), hasSelfMfs: jest.fn() }));
jest.mock('../../customer/customer.entity', () => ({ findByPk: jest.fn() }));
jest.mock('../../shop/shop.entity', () => ({ findByPk: jest.fn() }));
jest.mock('../../payment/payment-config.entity', () => ({ findAll: jest.fn() }));
jest.mock('../../delivery/delivery.service', () => ({
    createDeliveryOrder: jest.fn(),
    getActiveProvider: jest.fn(),
}));
jest.mock('../../delivery/delivery-tracking.service', () => ({
    createTrackingRecord: jest.fn(async () => ({ id: 'tracking-1' })),
}));
jest.mock('../../ai/action-gate', () => ({
    verifyAuthorization: jest.fn(() => true),
}));
jest.mock('../../notification/merchant-notification.service', () => ({
    notifyShop: jest.fn(async () => ({ queued: true })),
}));
jest.mock('../../notification/notification-events', () => ({
    NOTIFICATION_EVENTS: { COURIER_BOOKING_FAILED: 'courier_booking_failed' },
}));

const OrderSessionService = require('../order-session-standalone.service');
const deliveryService = require('../../delivery/delivery.service');
const deliveryTrackingService = require('../../delivery/delivery-tracking.service');
const merchantNotificationService = require('../../notification/merchant-notification.service');

const SHOP = 'shop-1';
const order = {
    id: 'order-1',
    order_number: 'ORD-SHOP-000001',
    total: 1250,
    items: [{ name: 'Red Saree', quantity: 1 }],
    update: jest.fn(async function update(values) {
        Object.assign(this, values);
    }),
};
const stepData = {
    name: 'Rahim',
    phone: '01711111111',
    address: 'Mirpur, Dhaka',
    notes: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
        callback();
        return 0;
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('courier dispatch reconciliation', () => {
    test('does not create a second parcel when the first attempt timed out after creation', async () => {
        const getOrderStatusByInvoice = jest.fn().mockResolvedValue({
            invoice: order.order_number,
            consignment_id: 'CN-1',
            tracking_code: 'TRK-1',
            delivery_status: 'pending',
        });
        deliveryService.getActiveProvider.mockResolvedValue({
            provider: 'steadfast',
            instance: { getOrderStatusByInvoice },
        });
        deliveryService.createDeliveryOrder.mockRejectedValueOnce(new Error('provider timeout'));

        const result = await OrderSessionService.dispatchParcelWithRetry(order, stepData, SHOP, {
            authorization: { actionType: 'BOOK_COURIER', shopId: SHOP },
        });

        expect(deliveryService.createDeliveryOrder).toHaveBeenCalledTimes(1);
        expect(getOrderStatusByInvoice).toHaveBeenCalledWith(order.order_number);
        expect(deliveryTrackingService.createTrackingRecord).toHaveBeenCalledWith(
            order,
            expect.objectContaining({ consignment_id: 'CN-1', tracking_code: 'TRK-1' })
        );
        expect(result).toEqual(expect.objectContaining({ tracking_code: 'TRK-1' }));
    });

    test('retries only after Steadfast confirms the invoice is absent', async () => {
        const getOrderStatusByInvoice = jest.fn()
            .mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
            .mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));
        deliveryService.getActiveProvider.mockResolvedValue({
            provider: 'steadfast',
            instance: { getOrderStatusByInvoice },
        });
        deliveryService.createDeliveryOrder
            .mockRejectedValueOnce(new Error('first attempt failed'))
            .mockResolvedValueOnce({
                provider: 'steadfast',
                consignment_id: 'CN-2',
                tracking_code: 'TRK-2',
                status: 'pending',
            });

        const result = await OrderSessionService.dispatchParcelWithRetry(order, stepData, SHOP, {
            authorization: { actionType: 'BOOK_COURIER', shopId: SHOP },
        });

        expect(getOrderStatusByInvoice).toHaveBeenCalledTimes(2);
        expect(deliveryService.createDeliveryOrder).toHaveBeenCalledTimes(2);
        expect(result).toEqual(expect.objectContaining({ tracking_code: 'TRK-2' }));
    });

    test('does not retry a provider without invoice lookup and marks dispatch indeterminate', async () => {
        deliveryService.getActiveProvider.mockResolvedValue({
            provider: 'pathao',
            instance: {},
        });
        deliveryService.createDeliveryOrder.mockRejectedValueOnce(new Error('pathao timeout'));

        const result = await OrderSessionService.dispatchParcelWithRetry(order, stepData, SHOP, {
            authorization: { actionType: 'BOOK_COURIER', shopId: SHOP },
        });

        expect(result).toBeNull();
        expect(deliveryService.createDeliveryOrder).toHaveBeenCalledTimes(1);
        expect(order.update).toHaveBeenCalledWith({ delivery_status: 'dispatch_indeterminate' });
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            SHOP,
            'courier_booking_failed',
            expect.objectContaining({ status: 'dispatch_indeterminate', provider: 'pathao' }),
            expect.any(Object)
        );
    });
});
