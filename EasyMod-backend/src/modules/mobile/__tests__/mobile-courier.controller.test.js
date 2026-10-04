'use strict';

jest.mock('../../order/order.service', () => ({
    bookForOrder: jest.fn(),
}));

jest.mock('../../entities', () => ({
    AuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-courier-1' }),
    },
    Order: {
        findOne: jest.fn(),
        findAndCountAll: jest.fn(),
    },
    DeliveryTracking: {
        findOne: jest.fn(),
    },
}));

jest.mock('../../../utils/redis-client', () => ({
    getRedisClient: jest.fn(() => ({
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue(null),
    })),
}));

const orderService = require('../../order/order.service');
const { AuditLog, Order, DeliveryTracking } = require('../../entities');
const controller = require('../mobile-courier.controller');

function response() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

describe('mobile Courier & Problem Center controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('bookCourier', () => {
        test('returns 404 if order does not exist or does not belong to shop', async () => {
            const res = response();
            Order.findOne.mockResolvedValue(null);

            let thrownError = null;
            try {
                await controller.bookCourier({
                    params: { orderId: 'ord-unknown' },
                    shop: { id: 'shop-1' },
                    user: { userId: 'user-1' },
                    body: { provider: 'steadfast' },
                }, res, (err) => { thrownError = err; });
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeTruthy();
            expect(thrownError.status).toBe(404);
            expect(thrownError.code).toBe('NOT_FOUND');
        });

        test('successfully books courier and records audit log', async () => {
            const res = response();
            const mockOrder = {
                id: 'ord-100',
                shop_id: 'shop-1',
                order_number: 'ORD-100',
            };
            Order.findOne.mockResolvedValue(mockOrder);
            orderService.bookForOrder.mockResolvedValue({
                tracking_code: 'SF-TRK-999',
                consignment_id: 'CS-888',
                provider: 'steadfast',
                status: 'booked',
            });

            await controller.bookCourier({
                params: { orderId: 'ord-100' },
                shop: { id: 'shop-1' },
                user: { userId: 'user-1' },
                body: { provider: 'steadfast', note: 'Fragile package' },
                headers: { 'x-idempotency-key': 'idem-book-1' },
            }, res, jest.fn());

            expect(orderService.bookForOrder).toHaveBeenCalledWith(mockOrder, expect.objectContaining({
                shopId: 'shop-1',
                provider: 'steadfast',
                trigger: 'MANUAL',
                overrides: expect.objectContaining({
                    note: 'Fragile package',
                }),
            }));

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    tracking_id: 'SF-TRK-999',
                    consignment_id: 'CS-888',
                    provider: 'steadfast',
                    status: 'booked',
                }),
            }));

            expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                action: 'COURIER_BOOKED',
                resource_id: 'ord-100',
                shop_id: 'shop-1',
                user_id: 'user-1',
                metadata: expect.objectContaining({
                    source: 'MOBILE',
                    provider: 'steadfast',
                    tracking_id: 'SF-TRK-999',
                }),
            }));
        });

        test('returns 409 COURIER_SETUP_REQUIRED when provider setup is missing', async () => {
            const res = response();
            Order.findOne.mockResolvedValue({ id: 'ord-100', shop_id: 'shop-1' });
            orderService.bookForOrder.mockResolvedValue({
                blocked: true,
                status: 'courier_setup_required',
                missing: ['api_key', 'secret_key'],
                provider: 'pathao',
            });

            await controller.bookCourier({
                params: { orderId: 'ord-100' },
                shop: { id: 'shop-1' },
                user: { userId: 'user-1' },
                body: { provider: 'pathao' },
            }, res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                error: expect.objectContaining({
                    code: 'COURIER_SETUP_REQUIRED',
                    provider: 'pathao',
                    missing: ['api_key', 'secret_key'],
                }),
            }));
        });

        test('returns 409 ORDER_CONFIDENCE_HOLD when order needs verification', async () => {
            const res = response();
            Order.findOne.mockResolvedValue({ id: 'ord-100', shop_id: 'shop-1' });
            orderService.bookForOrder.mockResolvedValue({
                blocked: true,
                status: 'confidence_hold',
                decision: 'HOLD',
                reasons: ['HIGH_RTO_RISK'],
                decision_version: '2.0',
            });

            await controller.bookCourier({
                params: { orderId: 'ord-100' },
                shop: { id: 'shop-1' },
                user: { userId: 'user-1' },
                body: { provider: 'steadfast' },
            }, res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                error: expect.objectContaining({
                    code: 'ORDER_CONFIDENCE_HOLD',
                    reasons: ['HIGH_RTO_RISK'],
                }),
            }));
        });

        test('returns 502 COURIER_BOOKING_FAILED when courier API fails', async () => {
            const res = response();
            Order.findOne.mockResolvedValue({ id: 'ord-100', shop_id: 'shop-1' });
            orderService.bookForOrder.mockResolvedValue({
                failed: true,
                reason: 'Invalid delivery address postal code',
            });

            await controller.bookCourier({
                params: { orderId: 'ord-100' },
                shop: { id: 'shop-1' },
                user: { userId: 'user-1' },
                body: { provider: 'steadfast' },
            }, res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(502);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                error: expect.objectContaining({
                    code: 'COURIER_BOOKING_FAILED',
                    message: 'Invalid delivery address postal code',
                }),
            }));
        });
    });

    describe('getProblemParcels', () => {
        test('queries problem parcels with default problem statuses and pagination', async () => {
            const res = response();
            Order.findAndCountAll.mockResolvedValue({
                count: 1,
                rows: [
                    {
                        id: 'ord-prob-1',
                        order_number: 'ORD-777',
                        customer_name: 'Tanvir Ahmed',
                        customer_phone: '01711223344',
                        total_amount: 1500,
                        delivery_provider: 'steadfast',
                        delivery_consignment_id: 'CS-777',
                        delivery_tracking_code: 'TRK-777',
                        delivery_status: 'failed_delivery',
                        order_status: 'confirmed',
                        delivery_address: 'Mirpur 10, Dhaka',
                        delivery_notes: 'Customer unreachable after 3 attempts',
                        created_at: new Date('2026-10-01T10:00:00Z'),
                        updated_at: new Date('2026-10-02T12:00:00Z'),
                    },
                ],
            });

            await controller.getProblemParcels({
                shop: { id: 'shop-1' },
                query: { page: '1', limit: '20' },
            }, res, jest.fn());

            expect(Order.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    shop_id: 'shop-1',
                }),
                limit: 20,
                offset: 0,
            }));

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    parcels: [
                        expect.objectContaining({
                            order_id: 'ord-prob-1',
                            order_number: 'ORD-777',
                            customer_name: 'Tanvir Ahmed',
                            customer_phone: '01711223344',
                            total_amount: 1500,
                            delivery_status: 'failed_delivery',
                            problem_reason: 'Customer unreachable after 3 attempts',
                        }),
                    ],
                    pagination: {
                        page: 1,
                        limit: 20,
                        total: 1,
                        hasNextPage: false,
                    },
                }),
            }));
        });
    });

    describe('getDeliveryTracking', () => {
        test('returns tracking timeline with provider history', async () => {
            const res = response();
            Order.findOne.mockResolvedValue({
                id: 'ord-trk-1',
                shop_id: 'shop-1',
                order_number: 'ORD-555',
                customer_name: 'Rafiqul Islam',
                customer_phone: '01811223344',
                total_amount: 2200,
                delivery_provider: 'pathao',
                delivery_consignment_id: 'CN-555',
                delivery_tracking_code: 'PT-555',
                delivery_status: 'in_transit',
                delivery_address: 'Gulshan 2, Dhaka',
                created_at: new Date(),
                updated_at: new Date(),
            });

            DeliveryTracking.findOne.mockResolvedValue({
                provider: 'pathao',
                tracking_number: 'PT-555',
                current_status: 'in_transit',
                estimated_delivery: new Date('2026-10-06T18:00:00Z'),
                status_history: [
                    { status: 'booked', timestamp: '2026-10-04T10:00:00Z', location: 'Dhaka Hub' },
                    { status: 'in_transit', timestamp: '2026-10-05T08:00:00Z', location: 'On the way' },
                ],
            });

            await controller.getDeliveryTracking({
                params: { orderId: 'ord-trk-1' },
                shop: { id: 'shop-1' },
            }, res, jest.fn());

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    order_id: 'ord-trk-1',
                    order_number: 'ORD-555',
                    provider: 'pathao',
                    tracking_number: 'PT-555',
                    current_status: 'in_transit',
                    status_history: expect.arrayContaining([
                        expect.objectContaining({ status: 'booked' }),
                        expect.objectContaining({ status: 'in_transit' }),
                    ]),
                    cod_derived_note: expect.stringContaining('Order-derived expectation'),
                }),
            }));
        });

        test('returns 404 if order is not found for shop', async () => {
            const res = response();
            Order.findOne.mockResolvedValue(null);

            let thrownError = null;
            try {
                await controller.getDeliveryTracking({
                    params: { orderId: 'ord-missing' },
                    shop: { id: 'shop-1' },
                }, res, (err) => { thrownError = err; });
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeTruthy();
            expect(thrownError.status).toBe(404);
        });
    });
});
