'use strict';

jest.mock('../order.service', () => ({ bookForOrder: jest.fn() }));
jest.mock('../../entities', () => ({ Order: { findOne: jest.fn() } }));

const orderController = require('../order.controller');
const orderService = require('../order.service');
const { Order } = require('../../entities');

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

describe('POST /order/:orderId/book-courier with RTO Shield v2', () => {
    const req = {
        params: { orderId: 'order-1' },
        user: { userId: 'user-1', shopId: 'shop-1' },
        body: { provider: 'pathao' },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        Order.findOne.mockResolvedValue({ id: 'order-1', shop_id: 'shop-1' });
    });

    test('passes trigger MANUAL and maps a hold to 409 ORDER_CONFIDENCE_HOLD with the reasons', async () => {
        orderService.bookForOrder.mockResolvedValue({
            blocked: true, status: 'confidence_hold', decision: 'MANUAL_REVIEW',
            reasons: ['REPEATED_RETURNS'], decision_version: 2,
        });
        const res = makeRes();
        await orderController.bookCourier(req, res, jest.fn());

        expect(orderService.bookForOrder).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'order-1' }),
            expect.objectContaining({ shopId: 'shop-1', trigger: 'MANUAL', provider: 'pathao' }),
        );
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: expect.objectContaining({
                code: 'ORDER_CONFIDENCE_HOLD',
                decision: 'MANUAL_REVIEW',
                reasons: ['REPEATED_RETURNS'],
                decision_version: 2,
            }),
        });
    });

    test('an engine failure is reported distinctly so the merchant retries instead of "fixing" the order', async () => {
        orderService.bookForOrder.mockResolvedValue({
            blocked: true, status: 'confidence_hold', engine_failure: true, reasons: ['ENGINE_UNAVAILABLE'],
        });
        const res = makeRes();
        await orderController.bookCourier(req, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json.mock.calls[0][0].error.code).toBe('ORDER_CONFIDENCE_UNAVAILABLE');
    });

    test('an indeterminate courier claim keeps its existing contract', async () => {
        orderService.bookForOrder.mockResolvedValue({ blocked: true, status: 'dispatch_indeterminate' });
        const res = makeRes();
        await orderController.bookCourier(req, res, jest.fn());
        expect(res.json.mock.calls[0][0].error.code).toBe('COURIER_DISPATCH_INDETERMINATE');
    });
});
