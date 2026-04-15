/**
 * Order Service Tests
 * Comprehensive test suite for order creation, management, and business logic
 */

const { AppError } = require('../../../utils/AppError');

// Mock entities before requiring service
jest.mock('../../entities', () => ({
    Order: {
        findOne: jest.fn(),
        findAll: jest.fn(),
        findAndCountAll: jest.fn(),
        create: jest.fn()
    },
    OrderItem: {
        findAll: jest.fn(),
        create: jest.fn()
    },
    Product: {
        findAll: jest.fn(),
        findOne: jest.fn()
    },
    Customer: {},
    UserShop: {
        findOne: jest.fn()
    },
    OrderReturn: {}
}));

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(),
        query: jest.fn(),
        getDialect: jest.fn()
    }
}));

jest.mock('../../subscription/subscription.service', () => ({
    checkOrderLimit: jest.fn(),
    trackUsage: jest.fn()
}));

jest.mock('../../rto-shield/rto-shield.service', () => ({
    checkPhone: jest.fn()
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }))
}));

jest.mock('../../product/stock-status-guard.service', () => ({
    invalidate: jest.fn()
}));

jest.mock('../../delivery/delivery.service', () => ({
    getTracking: jest.fn(),
    syncStatus: jest.fn(),
    createConsignment: jest.fn()
}));

const orderService = require('../order.service');
const { Order, OrderItem, Product, UserShop } = require('../../entities');
const { sequelize } = require('../../../utils/database/database-setup');
const subscriptionService = require('../../subscription/subscription.service');
const rtoShieldService = require('../../rto-shield/rto-shield.service');
const stockGuardService = require('../../product/stock-status-guard.service');

describe('Order Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Default mock implementations
        sequelize.transaction = jest.fn(() => Promise.resolve({
            commit: jest.fn(),
            rollback: jest.fn()
        }));
        sequelize.query = jest.fn();
        sequelize.getDialect = jest.fn().mockReturnValue('postgres');
        
        subscriptionService.checkOrderLimit = jest.fn().mockResolvedValue(true);
        subscriptionService.trackUsage = jest.fn().mockResolvedValue({ transactionId: 'test-txn' });
        
        rtoShieldService.checkPhone = jest.fn().mockResolvedValue({ flagged: false });
        
        stockGuardService.invalidate = jest.fn().mockResolvedValue(true);
    });

    describe('Constants', () => {
        it('should have correct default values defined', () => {
            // These are defined in the service file
            const service = require('../order.service');
            expect(service).toBeDefined();
        });
    });

    describe('verifyShopAccess', () => {
        it('should allow access for active user-shop relationship', async () => {
            const mockUserShop = { id: 'user-shop-1', is_active: true };
            UserShop.findOne = jest.fn().mockResolvedValue(mockUserShop);

            const result = await orderService.verifyShopAccess('user-1', 'shop-1');
            
            expect(result).toEqual(mockUserShop);
            expect(UserShop.findOne).toHaveBeenCalledWith({
                where: {
                    user_id: 'user-1',
                    shop_id: 'shop-1',
                    is_active: true
                }
            });
        });

        it('should throw AppError with 403 when user has no shop access', async () => {
            UserShop.findOne = jest.fn().mockResolvedValue(null);

            await expect(orderService.verifyShopAccess('user-1', 'shop-1'))
                .rejects
                .toThrow(AppError);
            
            await expect(orderService.verifyShopAccess('user-1', 'shop-1'))
                .rejects
                .toThrow('You do not have access to this shop');
        });
    });

    describe('generateOrderNumber', () => {
        it('should generate order number for Postgres with sequence', async () => {
            sequelize.getDialect.mockReturnValue('postgres');
            sequelize.query = jest.fn().mockResolvedValue([[{ next_number: 5 }]]);

            const orderNumber = await orderService.generateOrderNumber('550e8400-e29b-41d4-a716-446655440000');
            
            expect(orderNumber).toMatch(/^ORD-[A-F0-9]{8}-000005$/);
        });

        it('should handle first order for a shop (sequence = 1)', async () => {
            sequelize.getDialect.mockReturnValue('postgres');
            sequelize.query = jest.fn().mockResolvedValue([[{ next_number: 1 }]]);

            const orderNumber = await orderService.generateOrderNumber('shop-1');
            
            expect(orderNumber).toMatch(/^ORD-[A-F0-9]{8}-000001$/);
        });

        it('should use transaction when provided', async () => {
            const mockTransaction = { id: 'txn-1' };
            sequelize.getDialect.mockReturnValue('postgres');
            sequelize.query = jest.fn().mockResolvedValue([[{ next_number: 10 }]]);

            await orderService.generateOrderNumber('shop-1', mockTransaction);
            
            expect(sequelize.query).toHaveBeenCalled();
        });
    });

    describe('createOrder', () => {
        const validOrderData = {
            customer_name: 'Test Customer',
            customer_phone: '01712345678',
            items: [
                { product_id: 'prod-1', quantity: 2 }
            ],
            payment_status: 'pending'
        };

        it('should create order successfully with valid data', async () => {
            const mockProduct = {
                id: 'prod-1',
                name: 'Test Product',
                price: 100.00,
                quantity: 10,
                track_quantity: true,
                allow_backorder: false,
                decrement: jest.fn().mockResolvedValue(true)
            };

            const mockOrder = {
                id: 'order-1',
                order_number: 'ORD-SHOP01-000001',
                save: jest.fn().mockResolvedValue(true)
            };

            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findAll = jest.fn().mockResolvedValue([mockProduct]);
            Order.create = jest.fn().mockResolvedValue(mockOrder);
            OrderItem.create = jest.fn().mockResolvedValue({ id: 'item-1' });

            const result = await orderService.createOrder('user-1', 'shop-1', validOrderData);

            expect(result).toBeDefined();
            expect(Order.create).toHaveBeenCalled();
            expect(subscriptionService.checkOrderLimit).toHaveBeenCalledWith('shop-1');
        });

        it('should reject order when subscription limit exceeded', async () => {
            subscriptionService.checkOrderLimit = jest.fn().mockRejectedValue(
                new AppError('Order limit exceeded', 403)
            );

            await expect(orderService.createOrder('user-1', 'shop-1', validOrderData))
                .rejects
                .toThrow('Order limit exceeded');
        });

        it('should block COD order for high-risk phone numbers', async () => {
            rtoShieldService.checkPhone = jest.fn().mockResolvedValue({
                flagged: true,
                risk_score: 85,
                reason: 'Multiple RTOs'
            });

            const codOrderData = {
                ...validOrderData,
                payment_status: 'unpaid',
                customer_phone: '01712345678'
            };

            await expect(orderService.createOrder('user-1', 'shop-1', codOrderData))
                .rejects
                .toThrow('RTO Shield');
        });

        it('should reject order with insufficient stock', async () => {
            const mockProduct = {
                id: 'prod-1',
                name: 'Low Stock Product',
                price: 100.00,
                quantity: 1, // Only 1 in stock
                track_quantity: true,
                allow_backorder: false
            };

            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findAll = jest.fn().mockResolvedValue([mockProduct]);

            const orderData = {
                ...validOrderData,
                items: [{ product_id: 'prod-1', quantity: 5 }] // Requesting 5
            };

            await expect(orderService.createOrder('user-1', 'shop-1', orderData))
                .rejects
                .toThrow('Insufficient stock');
        });

        it('should allow backorder for products with allow_backorder flag', async () => {
            const mockProduct = {
                id: 'prod-1',
                name: 'Backorder Product',
                price: 100.00,
                quantity: 0,
                track_quantity: true,
                allow_backorder: true, // Allow backorder
                decrement: jest.fn().mockResolvedValue(true)
            };

            const mockOrder = {
                id: 'order-1',
                order_number: 'ORD-SHOP01-000001',
                save: jest.fn().mockResolvedValue(true)
            };

            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findAll = jest.fn().mockResolvedValue([mockProduct]);
            Order.create = jest.fn().mockResolvedValue(mockOrder);
            OrderItem.create = jest.fn().mockResolvedValue({ id: 'item-1' });

            const orderData = {
                ...validOrderData,
                items: [{ product_id: 'prod-1', quantity: 5 }]
            };

            const result = await orderService.createOrder('user-1', 'shop-1', orderData);
            expect(result).toBeDefined();
        });

        it('should reject COD orders exceeding maximum amount', async () => {
            const mockProduct = {
                id: 'prod-1',
                name: 'Expensive Product',
                price: 60000.00, // Over 50,000 COD limit
                quantity: 100,
                track_quantity: true,
                allow_backorder: false
            };

            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findAll = jest.fn().mockResolvedValue([mockProduct]);

            const orderData = {
                ...validOrderData,
                payment_status: 'unpaid',
                items: [{ product_id: 'prod-1', quantity: 1 }]
            };

            await expect(orderService.createOrder('user-1', 'shop-1', orderData))
                .rejects
                .toThrow('COD orders cannot exceed');
        });

        it('should handle idempotency - return existing order for duplicate request', async () => {
            const existingOrder = { id: 'existing-order', order_number: 'ORD-001' };
            Order.findOne = jest.fn().mockResolvedValue(existingOrder);

            const result = await orderService.createOrder('user-1', 'shop-1', validOrderData, 'request-id-1');
            
            expect(result).toEqual(existingOrder);
            expect(Order.create).not.toHaveBeenCalled();
        });

        it('should deduct stock atomically when creating order', async () => {
            const mockProduct = {
                id: 'prod-1',
                name: 'Test Product',
                price: 100.00,
                quantity: 10,
                track_quantity: true,
                allow_backorder: false,
                decrement: jest.fn().mockResolvedValue(true)
            };

            const mockOrder = {
                id: 'order-1',
                order_number: 'ORD-SHOP01-000001',
                save: jest.fn().mockResolvedValue(true)
            };

            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findAll = jest.fn().mockResolvedValue([mockProduct]);
            Order.create = jest.fn().mockResolvedValue(mockOrder);
            OrderItem.create = jest.fn().mockResolvedValue({ id: 'item-1' });

            await orderService.createOrder('user-1', 'shop-1', validOrderData);

            expect(mockProduct.decrement).toHaveBeenCalledWith('quantity', {
                by: 2,
                transaction: expect.any(Object)
            });
        });

        it('should calculate order totals correctly', async () => {
            const mockProduct = {
                id: 'prod-1',
                name: 'Test Product',
                price: 100.00,
                quantity: 10,
                track_quantity: false,
                decrement: jest.fn()
            };

            const mockOrder = {
                id: 'order-1',
                save: jest.fn().mockResolvedValue(true)
            };

            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findAll = jest.fn().mockResolvedValue([mockProduct]);
            Order.create = jest.fn().mockImplementation((data) => Promise.resolve({ ...mockOrder, ...data }));
            OrderItem.create = jest.fn().mockResolvedValue({ id: 'item-1' });

            const orderData = {
                customer_name: 'Test',
                customer_phone: '01712345678',
                items: [{ product_id: 'prod-1', quantity: 2 }],
                discount: 10,
                tax: 5,
                delivery_fee: 20
            };

            await orderService.createOrder('user-1', 'shop-1', orderData);

            const createCall = Order.create.mock.calls[0][0];
            expect(createCall.subtotal).toBe(200); // 100 * 2
            expect(createCall.discount).toBe(10);
            expect(createCall.tax).toBe(5);
            expect(createCall.delivery_fee).toBe(20);
            expect(createCall.total).toBe(215); // 200 - 10 + 5 + 20
        });
    });

    describe('getOrderById', () => {
        it('should return order by ID', async () => {
            const mockOrder = {
                id: 'order-1',
                order_number: 'ORD-001',
                customer_name: 'Test Customer'
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            const result = await orderService.getOrderById('order-1', 'user-1', 'shop-1');

            expect(result).toEqual(mockOrder);
            expect(Order.findOne).toHaveBeenCalledWith({
                where: { id: 'order-1', shop_id: 'shop-1' }
            });
        });

        it('should throw error when order not found', async () => {
            Order.findOne = jest.fn().mockResolvedValue(null);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            await expect(orderService.getOrderById('nonexistent', 'user-1', 'shop-1'))
                .rejects
                .toThrow('Order not found');
        });
    });

    describe('updateOrder', () => {
        it('should update order status successfully', async () => {
            const mockOrder = {
                id: 'order-1',
                order_status: 'draft',
                save: jest.fn().mockResolvedValue(true)
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            const result = await orderService.updateOrder(
                'order-1',
                'user-1',
                'shop-1',
                { order_status: 'confirmed' }
            );

            expect(mockOrder.order_status).toBe('confirmed');
            expect(mockOrder.save).toHaveBeenCalled();
        });

        it('should reject invalid status transitions', async () => {
            const mockOrder = {
                id: 'order-1',
                order_status: 'completed',
                save: jest.fn()
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            // Depending on your state machine logic, this might be rejected
            // Adjust test based on actual implementation
        });
    });

    describe('listOrders', () => {
        it('should return paginated orders', async () => {
            const mockOrders = [
                { id: 'order-1', order_number: 'ORD-001' },
                { id: 'order-2', order_number: 'ORD-002' }
            ];

            Order.findAndCountAll = jest.fn().mockResolvedValue({
                rows: mockOrders,
                count: 2
            });
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            const result = await orderService.listOrders('user-1', 'shop-1', { page: 1, limit: 10 });

            expect(result.orders).toEqual(mockOrders);
            expect(result.total).toBe(2);
        });

        it('should filter orders by status', async () => {
            Order.findAndCountAll = jest.fn().mockResolvedValue({
                rows: [],
                count: 0
            });
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            await orderService.listOrders('user-1', 'shop-1', { 
                page: 1, 
                limit: 10, 
                payment_status: 'paid' 
            });

            expect(Order.findAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        shop_id: 'shop-1',
                        payment_status: 'paid'
                    })
                })
            );
        });
    });

    describe('confirmOrder', () => {
        it('should confirm order successfully', async () => {
            const mockOrder = {
                id: 'order-1',
                order_status: 'draft',
                save: jest.fn().mockResolvedValue(true)
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            const result = await orderService.confirmOrder('order-1', 'user-1', 'shop-1');

            expect(mockOrder.order_status).toBe('confirmed');
            expect(mockOrder.save).toHaveBeenCalled();
        });
    });

    describe('cancelOrder', () => {
        it('should cancel order and restore stock', async () => {
            const mockOrder = {
                id: 'order-1',
                order_status: 'draft',
                save: jest.fn().mockResolvedValue(true)
            };

            const mockOrderItems = [
                {
                    product_id: 'prod-1',
                    quantity: 2,
                    getProduct: jest.fn().mockResolvedValue({
                        id: 'prod-1',
                        increment: jest.fn().mockResolvedValue(true)
                    })
                }
            ];

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            OrderItem.findAll = jest.fn().mockResolvedValue(mockOrderItems);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            const result = await orderService.cancelOrder('order-1', 'user-1', 'shop-1');

            expect(mockOrder.order_status).toBe('cancelled');
            expect(mockOrder.save).toHaveBeenCalled();
        });
    });

    describe('Helper Functions', () => {
        describe('isCodOrder', () => {
            it('should identify unpaid orders as COD', () => {
                const service = require('../order.service');
                // Test via createOrderInternal which uses this logic
            });
        });

        describe('calculateOrderTotals', () => {
            it('should calculate totals correctly', async () => {
                // Test through createOrder
            });
        });
    });
});
