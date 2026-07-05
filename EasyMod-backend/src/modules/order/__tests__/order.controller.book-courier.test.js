jest.mock('../../delivery/delivery.service', () => ({
    createDeliveryOrder: jest.fn()
}));

jest.mock('../../entities', () => ({
    Order: {
        findOne: jest.fn()
    }
}));

const orderController = require('../order.controller');
const deliveryService = require('../../delivery/delivery.service');
const { Order } = require('../../entities');

describe('orderController.bookCourier', () => {
    let req;
    let res;
    let next;
    let order;

    beforeEach(() => {
        jest.clearAllMocks();
        order = {
            id: 'order-1',
            customer_name: 'Launch Buyer',
            customer_phone: '01700000000',
            delivery_address: {
                street_address: 'Road 1',
                upazila: 'Dhanmondi',
                district: 'Dhaka'
            },
            total: 1200,
            update: jest.fn().mockResolvedValue(undefined)
        };
        req = {
            params: { orderId: 'order-1' },
            headers: { 'x-shop-id': 'spoofed-shop' },
            user: { userId: 'user-1', shopId: 'authenticated-shop' },
            body: { provider: 'pathao' }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
        Order.findOne.mockResolvedValue(order);
        deliveryService.createDeliveryOrder.mockResolvedValue({
            provider: 'pathao',
            consignment_id: 'CN-1',
            tracking_code: 'TRK-1'
        });
    });

    it('uses authenticated shop context instead of client-controlled x-shop-id', async () => {
        await orderController.bookCourier(req, res, next);

        expect(Order.findOne).toHaveBeenCalledWith({
            where: { id: 'order-1', shop_id: 'authenticated-shop' }
        });
        expect(deliveryService.createDeliveryOrder).toHaveBeenCalledWith(
            'authenticated-shop',
            expect.objectContaining({
                order_number: 'ORDER-1',
                recipient_name: 'Launch Buyer',
                recipient_phone: '01700000000',
                cod_amount: 1200
            }),
            'pathao'
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true
        }));
    });
});
