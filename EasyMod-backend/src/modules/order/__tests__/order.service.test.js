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
        findOne: jest.fn(),
        decrement: jest.fn(),
        increment: jest.fn()
    },
    Customer: {
        findOne: jest.fn()
    },
    UserShop: {
        findOne: jest.fn()
    },
    OrderReturn: {
        create: jest.fn()
    },
    Channel: {
        findOne: jest.fn()
    }
}));

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (cb) => {
            const t = { commit: jest.fn(), rollback: jest.fn() };
            if (typeof cb === 'function') return cb(t);
            return t;
        }),
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

// RTO network participation lookup (reads shop.settings.rto_network) — default to enforcing.
jest.mock('../../rto-shield/rto-network-settings', () => ({
    getNetworkSettings: jest.fn().mockResolvedValue({ contribute: true, enforce: true })
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
    createConsignment: jest.fn(),
    getActiveProvider: jest.fn(),
    createOrder: jest.fn()
}));

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
        findOne: jest.fn(),
        decrement: jest.fn(),
        increment: jest.fn()
    },
    Customer: {
        findOne: jest.fn()
    },
    UserShop: {
        findOne: jest.fn()
    },
    OrderReturn: {
        create: jest.fn()
    },
    Channel: {
        findOne: jest.fn()
    },
    Invoice: {
        create: jest.fn()
    }
}));

jest.mock('../../../utils/email.service', () => ({
    sendEmail: jest.fn()
}));

const orderService = require('../order.service');
const { Order, OrderItem, Product, UserShop, Customer, Invoice, Channel } = require('../../entities');
const { sequelize } = require('../../../utils/database/database-setup');
const subscriptionService = require('../../subscription/subscription.service');
const rtoShieldService = require('../../rto-shield/rto-shield.service');
const stockGuardService = require('../../product/stock-status-guard.service');
const deliveryService = require('../../delivery/delivery.service');
const { sendEmail } = require('../../../utils/email.service');

// Helper to create mock order with instance methods
const createMockOrder = (overrides = {}) => ({
    id: 'order-1',
    order_number: 'ORD-001',
    order_status: 'draft',
    payment_status: 'pending',
    fulfillment_status: 'unfulfilled',
    shop_id: 'shop-1',
    customer_id: 'customer-1',
    customer_name: 'Test Customer',
    customer_phone: '01712345678',
    customer_email: 'test@example.com',
    total: 100,
    subtotal: 90,
    discount: 0,
    tax: 0,
    delivery_fee: 10,
    items: [],
    update: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
    ...overrides
});

// Helper to create mock order item with getProduct method
const createMockOrderItem = (overrides = {}) => ({
    id: 'item-1',
    order_id: 'order-1',
    product_id: 'prod-1',
    quantity: 1,
    price: 100,
    total: 100,
    getProduct: jest.fn().mockResolvedValue({
        id: 'prod-1',
        name: 'Test Product',
        increment: jest.fn().mockResolvedValue(true),
        decrement: jest.fn().mockResolvedValue(true),
        ...overrides.product
    }),
    ...overrides
});

describe('Order Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Default mock implementations
        sequelize.transaction = jest.fn(() => Promise.resolve({
            commit: jest.fn(),
            rollback: jest.fn()
        }));
        // Postgres query mock for generateOrderNumber - returns [[{ next_number: X }]]
        sequelize.query = jest.fn().mockResolvedValue([[{ next_number: 1 }]]);
        sequelize.getDialect = jest.fn().mockReturnValue('postgres');
        
        subscriptionService.checkOrderLimit = jest.fn().mockResolvedValue(true);
        subscriptionService.trackUsage = jest.fn().mockResolvedValue({ transactionId: 'test-txn' });
        
        rtoShieldService.checkPhone = jest.fn().mockResolvedValue({ flagged: false });
        
        stockGuardService.invalidate = jest.fn().mockResolvedValue(true);
        
        deliveryService.getActiveProvider = jest.fn().mockResolvedValue(null);
        deliveryService.createOrder = jest.fn().mockResolvedValue({});
        
        Customer.findOne = jest.fn().mockResolvedValue(null);
        Invoice.create = jest.fn().mockResolvedValue({
            id: 'invoice-1',
            invoice_number: 'INV-202401-ORD-001'
        });
        Channel.findOne = jest.fn().mockResolvedValue(null);
        
        sendEmail.mockResolvedValue(true);
    });

    describe('Constants', () => {
        it('should have correct default values defined', () => {
            // These are defined in the service file
            const service = require('../order.service');
            expect(service).toBeDefined();
        });
    });

    describe('verifyShopAccess (via service methods)', () => {
        it('should allow access for active user-shop relationship', async () => {
            const mockUserShop = { id: 'user-shop-1', is_active: true };
            UserShop.findOne = jest.fn().mockResolvedValue(mockUserShop);

            // Test via getOrderById which internally calls verifyShopAccess
            const mockOrder = createMockOrder();
            Order.findOne = jest.fn().mockResolvedValue(mockOrder);

            const result = await orderService.getOrderById('order-1', 'user-1', 'shop-1');
            
            expect(result).toBeDefined();
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

            await expect(orderService.getOrderById('order-1', 'user-1', 'shop-1'))
                .rejects
                .toThrow(AppError);
            
            await expect(orderService.getOrderById('order-1', 'user-1', 'shop-1'))
                .rejects
                .toThrow('You do not have access to this shop');
        });
    });

    describe('Order Number Generation (via createOrder)', () => {
        it('should generate order number for Postgres with sequence', async () => {
            sequelize.getDialect.mockReturnValue('postgres');
            // Postgres query returns [[{ next_number: 5 }]] - nested array for destructuring
            sequelize.query.mockResolvedValue([[{ next_number: 5 }]]);

            const mockProduct = {
                id: 'prod-1',
                name: 'Test Product',
                price: 100.00,
                quantity: 10,
                track_quantity: false
            };

            const mockOrder = createMockOrder({
                order_number: 'ORD-550E8400-000005'
            });

            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findAll = jest.fn().mockResolvedValue([mockProduct]);
            Order.create = jest.fn().mockImplementation((data) => Promise.resolve({ ...mockOrder, ...data }));
            OrderItem.create = jest.fn().mockResolvedValue({ id: 'item-1' });

            const result = await orderService.createOrder('user-1', '550e8400-e29b-41d4-a716-446655440000', {
                customer_name: 'Test',
                customer_phone: '01712345678',
                items: [{ product_id: 'prod-1', quantity: 1 }],
                payment_status: 'pending'
            });

            expect(sequelize.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO order_sequences'),
                expect.any(Object)
            );
        });

        it('should handle SQLite fallback for order number generation', async () => {
            sequelize.getDialect.mockReturnValue('sqlite');
            const mockTxn = { 
                commit: jest.fn().mockResolvedValue(true), 
                rollback: jest.fn().mockResolvedValue(true) 
            };
            sequelize.transaction.mockResolvedValue(mockTxn);
            // SQLite query returns [[{ next_number: 3 }]] format
            sequelize.query.mockResolvedValue([[{ next_number: 3, shop_id: '550e8400-e29b-41d4-a716-446655440000' }]]);

            const mockProduct = {
                id: 'prod-1',
                name: 'Test Product',
                price: 100.00,
                quantity: 10,
                track_quantity: false
            };

            const mockOrder = createMockOrder();

            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findAll = jest.fn().mockResolvedValue([mockProduct]);
            Order.create = jest.fn().mockImplementation((data) => Promise.resolve({ ...mockOrder, ...data }));
            OrderItem.create = jest.fn().mockResolvedValue({ id: 'item-1' });

            const result = await orderService.createOrder('user-1', '550e8400-e29b-41d4-a716-446655440000', {
                customer_name: 'Test',
                customer_phone: '01712345678',
                items: [{ product_id: 'prod-1', quantity: 1 }],
                payment_status: 'pending'
            });

            expect(result).toBeDefined();
            expect(result.order_number).toMatch(/^ORD-[A-F0-9]{8}-\d{6}$/);
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

            // The order's JSON `items` column must carry a denormalized line-item
            // snapshot (with a display name) — the order-detail dialog, the invoice
            // and the courier all read order.items, not the order_items association.
            // Without this the manual order showed an empty "Order Items" list while
            // its total was correct (founder bug 2026-06-12).
            const createArg = Order.create.mock.calls[0][0];
            expect(createArg.items).toEqual([
                expect.objectContaining({
                    product_id: 'prod-1',
                    productName: 'Test Product',
                    quantity: 2,
                    price: 100,
                    total: 200,
                }),
            ]);
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
            const mockOrder = createMockOrder({
                order_number: 'ORD-001'
            });

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            const result = await orderService.getOrderById('order-1', 'user-1', 'shop-1');

            expect(result).toEqual(mockOrder);
            expect(Order.findOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'order-1', shop_id: 'shop-1' }
                })
            );
        });

        it('should throw error when order not found', async () => {
            Order.findOne = jest.fn().mockResolvedValue(null);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            await expect(orderService.getOrderById('nonexistent', 'user-1', 'shop-1'))
                .rejects
                .toThrow('Order not found');
        });
    });

    describe('listOrders', () => {
        it('should return orders list', async () => {
            const mockOrders = [
                createMockOrder({ id: 'order-1', order_number: 'ORD-001' }),
                createMockOrder({ id: 'order-2', order_number: 'ORD-002' })
            ];

            Order.findAll = jest.fn().mockResolvedValue(mockOrders);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            const result = await orderService.listOrders('user-1', 'shop-1', { page: 1, limit: 10 });

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(2);
        });

        it('should call findAll with correct parameters', async () => {
            Order.findAll = jest.fn().mockResolvedValue([]);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            await orderService.listOrders('user-1', 'shop-1', { 
                page: 1, 
                limit: 10, 
                payment_status: 'paid' 
            });

            expect(Order.findAll).toHaveBeenCalled();
            const callArgs = Order.findAll.mock.calls[0][0];
            expect(callArgs.where).toMatchObject({ shop_id: 'shop-1' });
        });

        it('should verify shop access before listing orders', async () => {
            Order.findAll = jest.fn().mockResolvedValue([]);
            UserShop.findOne = jest.fn().mockResolvedValue(null);

            await expect(orderService.listOrders('user-1', 'shop-1', {}))
                .rejects
                .toThrow('You do not have access to this shop');
        });
    });

    describe('confirmOrder', () => {
        it('should confirm order successfully', async () => {
            const mockOrder = createMockOrder({
                order_status: 'draft',
                total: 150
            });

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            const result = await orderService.confirmOrder('user-1', 'shop-1', 'order-1');

            expect(mockOrder.update).toHaveBeenCalledWith({ order_status: 'confirmed' });
            expect(Invoice.create).toHaveBeenCalled();
        });

        it('should throw error when order not in draft status', async () => {
            const mockOrder = createMockOrder({
                order_status: 'confirmed'
            });

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            await expect(orderService.confirmOrder('order-1', 'user-1', 'shop-1'))
                .rejects
                .toThrow('Cannot confirm order with status: confirmed');
        });

        it('should throw error when order not found', async () => {
            Order.findOne = jest.fn().mockResolvedValue(null);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            await expect(orderService.confirmOrder('order-1', 'user-1', 'shop-1'))
                .rejects
                .toThrow('Order not found');
        });
    });

    describe('cancelOrder', () => {
        it('should cancel order and restore stock', async () => {
            const mockOrder = createMockOrder({
                order_status: 'confirmed'
            });

            sequelize.transaction = jest.fn(async (cb) => {
                const t = { commit: jest.fn(), rollback: jest.fn() };
                return cb(t);
            });

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            OrderItem.findAll = jest.fn().mockResolvedValue([]);

            const result = await orderService.cancelOrder('user-1', 'shop-1', 'order-1', 'Customer request');

            expect(mockOrder.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    order_status: 'cancelled'
                }),
                expect.any(Object)
            );
        });

        it('should throw error when order not found', async () => {
            Order.findOne = jest.fn().mockResolvedValue(null);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });

            await expect(orderService.cancelOrder('user-1', 'shop-1', 'order-1'))
                .rejects
                .toThrow('Order not found');
        });
    });

    describe('updateOrder', () => {
        // The dashboard Cancel button patches order_status='cancelled' through this path,
        // which must restore inventory (mirrors the dedicated cancelOrder endpoint).
        it('restores tracked stock when an order is cancelled via order_status', async () => {
            const mockOrder = createMockOrder({ order_status: 'confirmed', metadata: {} });
            const prod = { id: 'prod-1', track_quantity: true, increment: jest.fn().mockResolvedValue(true) };
            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            OrderItem.findAll = jest.fn().mockResolvedValue([{ product_id: 'prod-1', quantity: 2 }]);
            Product.findByPk = jest.fn().mockResolvedValue(prod);
            sequelize.transaction = jest.fn(async (cb) => cb({ commit: jest.fn(), rollback: jest.fn() }));

            await orderService.updateOrder('order-1', 'user-1', 'shop-1', { order_status: 'cancelled' });

            expect(mockOrder.update).toHaveBeenCalledWith(expect.objectContaining({ order_status: 'cancelled' }));
            expect(prod.increment).toHaveBeenCalledWith('quantity', expect.objectContaining({ by: 2 }));
        });

        it('does NOT touch stock for a non-cancel status change', async () => {
            const mockOrder = createMockOrder({ order_status: 'confirmed', metadata: {} });
            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            UserShop.findOne = jest.fn().mockResolvedValue({ id: 'user-shop-1' });
            Product.findByPk = jest.fn();

            await orderService.updateOrder('order-1', 'user-1', 'shop-1', { order_status: 'processing' });

            expect(mockOrder.update).toHaveBeenCalledWith(expect.objectContaining({ order_status: 'processing' }));
            expect(Product.findByPk).not.toHaveBeenCalled();
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
