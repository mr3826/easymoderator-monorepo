'use strict';

jest.mock('../../customer/customer.service', () => ({ getCustomerById: jest.fn() }));
jest.mock('../../order/order.service', () => ({ getOrdersByCustomer: jest.fn() }));

const customerService = require('../../customer/customer.service');
const orderService = require('../../order/order.service');
const controller = require('../mobile-customer.controller');

function response() { return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }; }

test('returns a shop-scoped customer quick view with bounded recent orders', async () => {
    const res = response();
    customerService.getCustomerById.mockResolvedValue({ id: 'customer-a', name: 'Pilot Customer' });
    orderService.getOrdersByCustomer.mockResolvedValue([]);

    await controller.getCustomerQuickView({ params: { customerId: 'customer-a' }, user: { userId: 'user-a' }, shop: { id: 'shop-a' } }, res, jest.fn());

    expect(customerService.getCustomerById).toHaveBeenCalledWith('customer-a', 'user-a', 'shop-a');
    expect(orderService.getOrdersByCustomer).toHaveBeenCalledWith('user-a', 'shop-a', 'customer-a', { limit: 10 });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});
