'use strict';

jest.mock('../../customer/customer.service', () => ({ getCustomerById: jest.fn() }));
jest.mock('../../order/order.service', () => ({ getOrdersByCustomer: jest.fn() }));
jest.mock('../../entities', () => ({
    CustomerDeliveryStats: { findOne: jest.fn() },
}));

const customerService = require('../../customer/customer.service');
const orderService = require('../../order/order.service');
const { CustomerDeliveryStats } = require('../../entities');
const controller = require('../mobile-customer.controller');

function response() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

describe('mobile-customer.controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        CustomerDeliveryStats.findOne.mockReset();
    });

    test('returns a shop-scoped customer quick view with bounded recent orders and calculated stats', async () => {
        const res = response();
        customerService.getCustomerById.mockResolvedValue({
            id: 'customer-a',
            name: 'Pilot Customer',
            phone: '01711112233',
        });
        orderService.getOrdersByCustomer.mockResolvedValue([
            { id: 'ord-1', order_status: 'delivered', fulfillment_status: 'delivered', total: 1200 },
            { id: 'ord-2', order_status: 'delivered', fulfillment_status: 'delivered', total: 800 },
            { id: 'ord-3', order_status: 'returned', fulfillment_status: 'returned', total: 500 },
            { id: 'ord-4', order_status: 'cancelled', fulfillment_status: 'unfulfilled', total: 300 },
        ]);
        CustomerDeliveryStats.findOne.mockResolvedValue(null);

        await controller.getCustomerQuickView(
            { params: { customerId: 'customer-a' }, user: { userId: 'user-a' }, shop: { id: 'shop-a' } },
            res,
            jest.fn()
        );

        expect(customerService.getCustomerById).toHaveBeenCalledWith('customer-a', 'user-a', 'shop-a');
        expect(orderService.getOrdersByCustomer).toHaveBeenCalledWith('user-a', 'shop-a', 'customer-a', { limit: 10 });
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    customer: expect.objectContaining({ id: 'customer-a' }),
                    orders: expect.any(Array),
                    stats: {
                        total_orders: 4,
                        delivered_count: 2,
                        rto_count: 1,
                        cancelled_count: 1,
                        return_rate: 25,
                    },
                }),
            })
        );
    });

    test('incorporates CustomerDeliveryStats when available for phone', async () => {
        const res = response();
        customerService.getCustomerById.mockResolvedValue({
            id: 'customer-b',
            name: 'High Risk Customer',
            phone: '01899998888',
        });
        orderService.getOrdersByCustomer.mockResolvedValue([
            { id: 'ord-5', order_status: 'pending', fulfillment_status: 'pending' },
        ]);
        CustomerDeliveryStats.findOne.mockResolvedValue({
            shop_id: 'shop-a',
            phone: '01899998888',
            delivery_attempts: 10,
            rto_count: 4,
        });

        await controller.getCustomerQuickView(
            { params: { customerId: 'customer-b' }, user: { userId: 'user-a' }, shop: { id: 'shop-a' } },
            res,
            jest.fn()
        );

        expect(CustomerDeliveryStats.findOne).toHaveBeenCalledWith({
            where: { shop_id: 'shop-a', phone: '01899998888' },
        });
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    stats: {
                        total_orders: 10, // 6 delivered + 4 rto
                        delivered_count: 6,
                        rto_count: 4,
                        cancelled_count: 0,
                        return_rate: 40,
                    },
                }),
            })
        );
    });

    test('throws 400 validation error if customerId parameter is blank', async () => {
        const next = jest.fn();
        await controller.getCustomerQuickView(
            { params: { customerId: '  ' }, user: { userId: 'user-a' }, shop: { id: 'shop-a' } },
            response(),
            next
        );

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 400,
                message: 'Customer ID is required',
            })
        );
    });
});

