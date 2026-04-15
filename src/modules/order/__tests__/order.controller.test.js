/**
 * Order Controller Tests
 * Tests HTTP endpoints and request/response handling
 */

const orderController = require('../order.controller');
const orderService = require('../order.service');
const { AppError } = require('../../../utils/AppError');

// Mock the order service
jest.mock('../order.service');

describe('Order Controller', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockReq = {
            user: {
                userId: 'user-1',
                shopId: 'shop-1'
            },
            body: {},
            params: {},
            query: {}
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };

        mockNext = jest.fn();
    });

    describe('createOrder', () => {
        it('should create order and return 201', async () => {
            const orderData = {
                customer_name: 'Test Customer',
                customer_phone: '01712345678',
                items: [{ product_id: 'prod-1', quantity: 1 }]
            };
            
            mockReq.body = orderData;
            
            const createdOrder = {
                id: 'order-1',
                order_number: 'ORD-001',
                ...orderData
            };
            
            orderService.createOrder.mockResolvedValue(createdOrder);

            await orderController.createOrder(mockReq, mockRes, mockNext);

            expect(orderService.createOrder).toHaveBeenCalledWith('user-1', 'shop-1', orderData);
            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: createdOrder
            });
        });

        it('should return 400 when no shop selected', async () => {
            mockReq.user.shopId = null;

            await orderController.createOrder(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        });

        it('should call next with error on service failure', async () => {
            const error = new AppError('Order limit exceeded', 403);
            orderService.createOrder.mockRejectedValue(error);

            await orderController.createOrder(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(error);
        });
    });

    describe('updateOrder', () => {
        it('should update order and return 200', async () => {
            mockReq.body = { order_id: 'order-1', order_status: 'confirmed' };
            
            const updatedOrder = {
                id: 'order-1',
                order_status: 'confirmed'
            };
            
            orderService.updateOrder.mockResolvedValue(updatedOrder);

            await orderController.updateOrder(mockReq, mockRes, mockNext);

            expect(orderService.updateOrder).toHaveBeenCalledWith(
                'order-1',
                'user-1',
                'shop-1',
                { order_status: 'confirmed' }
            );
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: updatedOrder
            });
        });

        it('should extract order_id from various sources', async () => {
            // Test body.order_id
            mockReq.body = { order_id: 'order-1', status: 'confirmed' };
            orderService.updateOrder.mockResolvedValue({ id: 'order-1' });

            await orderController.updateOrder(mockReq, mockRes, mockNext);
            expect(orderService.updateOrder).toHaveBeenCalledWith('order-1', expect.anything(), expect.anything(), expect.anything());

            // Test body.id
            jest.clearAllMocks();
            mockReq.body = { id: 'order-2', status: 'confirmed' };
            orderService.updateOrder.mockResolvedValue({ id: 'order-2' });

            await orderController.updateOrder(mockReq, mockRes, mockNext);
            expect(orderService.updateOrder).toHaveBeenCalledWith('order-2', expect.anything(), expect.anything(), expect.anything());
        });

        it('should throw error when order_id is missing', async () => {
            mockReq.body = { order_status: 'confirmed' };

            await orderController.updateOrder(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
        });
    });

    describe('getOrder', () => {
        it('should return order by ID', async () => {
            mockReq.query = { order_id: 'order-1' };
            
            const order = {
                id: 'order-1',
                order_number: 'ORD-001',
                customer_name: 'Test'
            };
            
            orderService.getOrderById.mockResolvedValue(order);

            await orderController.getOrder(mockReq, mockRes, mockNext);

            expect(orderService.getOrderById).toHaveBeenCalledWith('order-1', 'user-1', 'shop-1');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: order
            });
        });

        it('should throw error when order_id is missing', async () => {
            mockReq.query = {};

            await orderController.getOrder(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
        });
    });

    describe('listOrders', () => {
        it('should return paginated orders', async () => {
            mockReq.query = { page: '1', limit: '10' };
            
            const result = {
                orders: [{ id: 'order-1' }, { id: 'order-2' }],
                total: 2,
                page: 1,
                totalPages: 1
            };
            
            orderService.listOrders.mockResolvedValue(result);

            await orderController.listOrders(mockReq, mockRes, mockNext);

            expect(orderService.listOrders).toHaveBeenCalledWith('user-1', 'shop-1', {
                page: 1,
                limit: 10,
                payment_status: undefined,
                fulfillment_status: undefined,
                search: undefined,
                start_date: undefined,
                end_date: undefined
            });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: result.orders,
                pagination: {
                    total: 2,
                    page: 1,
                    limit: 10,
                    totalPages: 1
                }
            });
        });

        it('should handle query parameters correctly', async () => {
            mockReq.query = {
                page: '2',
                limit: '20',
                search: 'test',
                payment_status: 'paid',
                start_date: '2024-01-01',
                end_date: '2024-12-31'
            };
            
            orderService.listOrders.mockResolvedValue({ orders: [], total: 0, page: 2 });

            await orderController.listOrders(mockReq, mockRes, mockNext);

            expect(orderService.listOrders).toHaveBeenCalledWith(
                'user-1',
                'shop-1',
                expect.objectContaining({
                    page: 2,
                    limit: 20,
                    search: 'test',
                    payment_status: 'paid',
                    start_date: '2024-01-01',
                    end_date: '2024-12-31'
                })
            );
        });

        it('should use default pagination when not provided', async () => {
            mockReq.query = {};
            orderService.listOrders.mockResolvedValue({ orders: [], total: 0 });

            await orderController.listOrders(mockReq, mockRes, mockNext);

            expect(orderService.listOrders).toHaveBeenCalledWith(
                'user-1',
                'shop-1',
                expect.objectContaining({
                    page: 1,
                    limit: 10
                })
            );
        });
    });

    describe('confirmOrder', () => {
        it('should confirm order and return 200', async () => {
            mockReq.params = { id: 'order-1' };
            
            const confirmedOrder = {
                id: 'order-1',
                order_status: 'confirmed'
            };
            
            orderService.confirmOrder.mockResolvedValue(confirmedOrder);

            await orderController.confirmOrder(mockReq, mockRes, mockNext);

            expect(orderService.confirmOrder).toHaveBeenCalledWith('order-1', 'user-1', 'shop-1');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: confirmedOrder
            });
        });

        it('should require order ID in params', async () => {
            mockReq.params = {};
            
            await orderController.confirmOrder(mockReq, mockRes, mockNext);
            
            expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
        });
    });

    describe('cancelOrder', () => {
        it('should cancel order and return 200', async () => {
            mockReq.params = { id: 'order-1' };
            
            const cancelledOrder = {
                id: 'order-1',
                order_status: 'cancelled'
            };
            
            orderService.cancelOrder.mockResolvedValue(cancelledOrder);

            await orderController.cancelOrder(mockReq, mockRes, mockNext);

            expect(orderService.cancelOrder).toHaveBeenCalledWith('order-1', 'user-1', 'shop-1');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: cancelledOrder
            });
        });
    });

    describe('deleteOrder', () => {
        it('should delete order and return 200', async () => {
            mockReq.params = { id: 'order-1' };
            
            orderService.deleteOrder.mockResolvedValue(true);

            await orderController.deleteOrder(mockReq, mockRes, mockNext);

            expect(orderService.deleteOrder).toHaveBeenCalledWith('order-1', 'user-1', 'shop-1');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: { deleted: true }
            });
        });
    });

    describe('getOrdersByCustomer', () => {
        it('should return orders for specific customer', async () => {
            mockReq.params = { customerId: 'customer-1' };
            
            const orders = [
                { id: 'order-1', customer_id: 'customer-1' },
                { id: 'order-2', customer_id: 'customer-1' }
            ];
            
            orderService.getOrdersByCustomer.mockResolvedValue(orders);

            await orderController.getOrdersByCustomer(mockReq, mockRes, mockNext);

            expect(orderService.getOrdersByCustomer).toHaveBeenCalledWith('customer-1', 'user-1', 'shop-1');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: orders
            });
        });
    });

    describe('finalizeOrder', () => {
        it('should finalize order and return 200', async () => {
            mockReq.params = { id: 'order-1' };
            mockReq.body = { payment_status: 'paid' };
            
            const finalizedOrder = {
                id: 'order-1',
                order_status: 'completed',
                payment_status: 'paid'
            };
            
            orderService.finalizeOrder.mockResolvedValue(finalizedOrder);

            await orderController.finalizeOrder(mockReq, mockRes, mockNext);

            expect(orderService.finalizeOrder).toHaveBeenCalledWith('order-1', 'user-1', 'shop-1', mockReq.body);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: finalizedOrder
            });
        });
    });

    describe('createReturnRequest', () => {
        it('should create return request and return 201', async () => {
            mockReq.params = { id: 'order-1' };
            mockReq.body = {
                items: [{ order_item_id: 'item-1', quantity: 1, reason: 'defective' }],
                reason: 'Product defective'
            };
            
            const returnRequest = {
                id: 'return-1',
                order_id: 'order-1',
                status: 'pending'
            };
            
            orderService.createReturnRequest.mockResolvedValue(returnRequest);

            await orderController.createReturnRequest(mockReq, mockRes, mockNext);

            expect(orderService.createReturnRequest).toHaveBeenCalledWith('order-1', 'user-1', 'shop-1', mockReq.body);
            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: returnRequest
            });
        });
    });
});
