'use strict';

jest.mock('../../order/order.service', () => ({
    listOrders: jest.fn(),
    getOrderById: jest.fn(),
    confirmOrder: jest.fn(),
    cancelOrder: jest.fn(),
    createOrder: jest.fn(),
}));

jest.mock('../../entities', () => ({
    AuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    Order: {
        findAll: jest.fn().mockResolvedValue([]),
    },
    Customer: {
        findOne: jest.fn().mockResolvedValue(null),
    },
    CustomerDeliveryStats: {
        findOne: jest.fn().mockResolvedValue(null),
    },
}));

const orderService = require('../../order/order.service');
const { AuditLog, Order, Customer, CustomerDeliveryStats } = require('../../entities');
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

describe('mobile Orders write contract (confirm & cancel)', () => {
    beforeEach(() => jest.clearAllMocks());

    test('confirmOrder successfully confirms order and creates audit log', async () => {
        const res = response();
        orderService.confirmOrder.mockResolvedValue(true);
        orderService.getOrderById.mockResolvedValue({
            id: 'ord-123',
            order_number: 'ORD-101',
            order_status: 'confirmed',
            total: 1500,
        });

        await controller.confirmOrder({
            params: { orderId: 'ord-123' },
            headers: { 'x-idempotency-key': 'idem-conf-1' },
            user: { userId: 'user-a' },
            shop: { id: 'shop-a' },
        }, res, jest.fn());

        expect(orderService.confirmOrder).toHaveBeenCalledWith('ord-123', 'user-a', 'shop-a');
        expect(orderService.getOrderById).toHaveBeenCalledWith('ord-123', 'user-a', 'shop-a');
        expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            user_id: 'user-a',
            shop_id: 'shop-a',
            action: 'ORDER_CONFIRMED',
            resource_type: 'order',
            resource_id: 'ord-123',
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                success: true,
                order: expect.objectContaining({ id: 'ord-123', order_status: 'confirmed' }),
            }),
        }));
    });

    test('confirmOrder handles already-confirmed order idempotently', async () => {
        const res = response();
        orderService.confirmOrder.mockRejectedValue(new Error('Cannot confirm order with status: confirmed'));
        orderService.getOrderById.mockResolvedValue({
            id: 'ord-123',
            order_number: 'ORD-101',
            order_status: 'confirmed',
            total: 1500,
        });

        await controller.confirmOrder({
            params: { orderId: 'ord-123' },
            headers: { 'x-idempotency-key': 'idem-conf-dup' },
            user: { userId: 'user-a' },
            shop: { id: 'shop-a' },
        }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                success: true,
                order: expect.objectContaining({ id: 'ord-123', order_status: 'confirmed' }),
                idempotencyReplay: true,
            }),
        }));
    });

    test('cancelOrder successfully cancels order with reason and records audit log', async () => {
        const res = response();
        orderService.cancelOrder.mockResolvedValue(true);
        orderService.getOrderById.mockResolvedValue({
            id: 'ord-123',
            order_number: 'ORD-101',
            order_status: 'cancelled',
            total: 1500,
        });

        await controller.cancelOrder({
            params: { orderId: 'ord-123' },
            body: { reason: 'Customer requested cancellation via phone' },
            headers: { 'x-idempotency-key': 'idem-canc-1' },
            user: { userId: 'user-a' },
            shop: { id: 'shop-a' },
        }, res, jest.fn());

        expect(orderService.cancelOrder).toHaveBeenCalledWith('user-a', 'shop-a', 'ord-123', 'Customer requested cancellation via phone');
        expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            action: 'ORDER_CANCELLED',
            resource_type: 'order',
            resource_id: 'ord-123',
            metadata: expect.objectContaining({
                source: 'MOBILE',
                reason: 'Customer requested cancellation via phone',
            }),
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                success: true,
                order: expect.objectContaining({ id: 'ord-123', order_status: 'cancelled' }),
            }),
        }));
    });
});

describe('mobile Customer Risk Summary contract', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns accurate risk metrics and flags high risk on duplicate recent order', async () => {
        const res = response();
        const now = Date.now();
        orderService.getOrderById.mockResolvedValue({
            id: 'ord-target',
            customer_phone: '01711000000',
            customer_id: 'cust-1',
            created_at: new Date(now).toISOString(),
        });

        Order.findAll.mockResolvedValue([
            { id: 'ord-target', order_status: 'confirmed', fulfillment_status: 'unfulfilled', created_at: new Date(now).toISOString() },
            { id: 'ord-past-delivered', order_status: 'fulfilled', fulfillment_status: 'delivered', created_at: new Date(now - 86400000).toISOString() },
            { id: 'ord-recent-duplicate', order_status: 'confirmed', fulfillment_status: 'unfulfilled', created_at: new Date(now - 10 * 60 * 1000).toISOString() }, // 10 mins ago
        ]);

        await controller.getCustomerRiskSummary({
            params: { orderId: 'ord-target' },
            user: { userId: 'user-a' },
            shop: { id: 'shop-a' },
        }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                risk: expect.objectContaining({
                    delivered_count: 1,
                    rto_count: 0,
                    cancelled_count: 0,
                    total_orders: 3,
                    has_duplicate_recent_order: true,
                    recent_order_id: 'ord-recent-duplicate',
                    risk_level: 'high',
                }),
            }),
        }));
    });

    test('returns low risk when customer has clean delivery history without duplicate orders', async () => {
        const res = response();
        const now = Date.now();
        orderService.getOrderById.mockResolvedValue({
            id: 'ord-clean',
            customer_phone: '01811000000',
            created_at: new Date(now).toISOString(),
        });

        Order.findAll.mockResolvedValue([
            { id: 'ord-clean', order_status: 'draft', created_at: new Date(now).toISOString() },
            { id: 'ord-past-1', order_status: 'delivered', fulfillment_status: 'delivered', created_at: new Date(now - 7 * 86400000).toISOString() },
        ]);

        await controller.getCustomerRiskSummary({
            params: { orderId: 'ord-clean' },
            user: { userId: 'user-a' },
            shop: { id: 'shop-a' },
        }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                risk: expect.objectContaining({
                    delivered_count: 1,
                    rto_count: 0,
                    has_duplicate_recent_order: false,
                    risk_level: 'low',
                }),
            }),
        }));
    });
});

describe('mobile Quick Manual Order creation contract', () => {
    beforeEach(() => jest.clearAllMocks());

    test('creates manual order with validated items and customer phone', async () => {
        const res = response();
        orderService.createOrder.mockResolvedValue({
            id: 'ord-created-1',
            order_number: 'ORD-999',
            total: 1200,
            order_status: 'confirmed',
        });

        await controller.createManualOrder({
            body: {
                customer_name: 'Karim Ahmed',
                customer_phone: '01911000000',
                delivery_address: 'Dhanmondi, Dhaka',
                items: [{ product_id: 'prod-1', quantity: 2, price: 600, name: 'Cotton T-Shirt' }],
                delivery_fee: 60,
            },
            headers: { 'x-idempotency-key': 'idem-create-1' },
            user: { userId: 'user-a' },
            shop: { id: 'shop-a' },
        }, res, jest.fn());

        expect(orderService.createOrder).toHaveBeenCalledWith(
            'user-a',
            'shop-a',
            expect.objectContaining({
                customer_name: 'Karim Ahmed',
                customer_phone: '01911000000',
                shipping_address: 'Dhanmondi, Dhaka',
                channel: 'mobile_manual',
                order_status: 'confirmed',
                items: [{ product_id: 'prod-1', quantity: 2, price: 600 }],
                delivery_fee: 60,
            }),
            'idem-create-1'
        );
        expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            action: 'ORDER_CREATED',
            resource_type: 'order',
            resource_id: 'ord-created-1',
        }));
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test('rejects manual order creation when items list is missing or empty', async () => {
        const next = jest.fn();
        await controller.createManualOrder({
            body: { customer_phone: '01911000000', items: [] },
            user: { userId: 'user-a' },
            shop: { id: 'shop-a' },
        }, response(), next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            status: 400,
            code: 'VALIDATION_ERROR',
        }));
    });
});
