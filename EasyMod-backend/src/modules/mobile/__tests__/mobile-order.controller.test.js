'use strict';

jest.mock('../../order/order.service', () => ({
    listOrders: jest.fn(),
    getOrderById: jest.fn(),
}));

const orderService = require('../../order/order.service');
const controller = require('../mobile-order.controller');

function response() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('mobile Orders read contract', () => {
    beforeEach(() => jest.clearAllMocks());

    test('bounds list pages and returns a next-page signal', async () => {
        const res = response();
        orderService.listOrders.mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({ id: `order-${index}` })));

        await controller.getOrders({
            user: { userId: 'user-a' },
            shop: { id: 'shop-a' },
            query: { page: '2', limit: '999', order_status: 'confirmed', search: 'pilot' },
        }, res, jest.fn());

        expect(orderService.listOrders).toHaveBeenCalledWith('user-a', 'shop-a', expect.objectContaining({
            page: 2,
            limit: 51,
            order_status: 'confirmed',
            search: 'pilot',
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                orders: expect.any(Array),
                pagination: { page: 2, limit: 50, hasNextPage: true },
            }),
        }));
    });

    test('passes the native session shop to order detail', async () => {
        const res = response();
        orderService.getOrderById.mockResolvedValue({ id: 'order-a' });

        await controller.getOrder({ params: { orderId: 'order-a' }, user: { userId: 'user-a' }, shop: { id: 'shop-a' } }, res, jest.fn());

        expect(orderService.getOrderById).toHaveBeenCalledWith('order-a', 'user-a', 'shop-a');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
});
