/**
 * Order Cancel / Return — Inventory Sync Tests (CRITICAL BUG FIX COVERAGE)
 * Verifies that cancelling an order or approving a return restores product quantities.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (cb) => {
            if (typeof cb === 'function') return cb(mockTransaction);
            return mockTransaction;
        }),
        query: jest.fn().mockResolvedValue([[{ next_number: 1 }]]),
        getDialect: jest.fn().mockReturnValue('postgres'),
        literal: jest.fn((s) => s),
        define: jest.fn().mockReturnValue({ findAll: jest.fn(), findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn() })
    }
}));

const mockProduct = {
    id: 'prod-1',
    name: 'Test Product',
    track_quantity: true,
    quantity: 8,
    increment: jest.fn().mockResolvedValue(true),
    decrement: jest.fn().mockResolvedValue(true)
};

const mockOrderItems = [
    { id: 'item-1', product_id: 'prod-1', quantity: 2, price: 500, getProduct: jest.fn().mockResolvedValue(mockProduct) },
    { id: 'item-2', product_id: 'prod-2', quantity: 1, price: 300, getProduct: jest.fn().mockResolvedValue({ ...mockProduct, id: 'prod-2', track_quantity: false }) }
];

const makeOrder = (overrides = {}) => ({
    id: 'order-1',
    shop_id: 'shop-1',
    status: 'confirmed',
    order_number: 'ORD-001',
    customer_id: 'cust-1',
    total_amount: 1000,
    items: mockOrderItems,
    update: jest.fn(async (data) => Object.assign(order, data)),
    ...overrides
});

let order;

const makeReturn = (overrides = {}) => ({
    id: 'ret-1',
    order_id: 'order-1',
    shop_id: 'shop-1',
    status: 'pending',
    items: [{ product_id: 'prod-1', quantity: 2 }],
    update: jest.fn().mockResolvedValue(true),
    ...overrides
});

jest.mock('../../entities', () => ({
    Order: {
        findOne: jest.fn(),
        findByPk: jest.fn(),
        findAll: jest.fn(),
        findAndCountAll: jest.fn(),
        create: jest.fn()
    },
    OrderItem: {
        findAll: jest.fn(),
        create: jest.fn(),
        bulkCreate: jest.fn()
    },
    Product: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        findByPk: jest.fn(),
        decrement: jest.fn().mockResolvedValue(true),
        increment: jest.fn().mockResolvedValue(true)
    },
    Customer: { findOne: jest.fn() },
    UserShop: { findOne: jest.fn() },
    Channel: { findOne: jest.fn() },
    OrderReturn: {
        findOne: jest.fn(),
        create: jest.fn(),
        findAll: jest.fn()
    },
    Invoice: { create: jest.fn() }
}));

jest.mock('../../../utils/AppError', () => ({
    AppError: class AppError extends Error {
        constructor(msg, code) { super(msg); this.statusCode = code; }
    }
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))
}));

jest.mock('../../subscription/subscription.service', () => ({
    checkOrderLimit: jest.fn().mockResolvedValue(true),
    trackUsage: jest.fn()
}));

jest.mock('../../rto-shield/rto-shield.service', () => ({
    checkPhone: jest.fn().mockResolvedValue({ score: 0 })
}));

jest.mock('../../product/stock-status-guard.service', () => ({
    invalidate: jest.fn().mockResolvedValue(true),
    getStockStatus: jest.fn().mockResolvedValue('in_stock')
}));

jest.mock('../../../utils/email.service', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../jobs/queue-manager', () => ({
    queues: { notifications: { add: jest.fn().mockResolvedValue({ id: 'notif-1' }) } }
}));

// ── Require after mocks ───────────────────────────────────────────────────────

const orderService = require('../order.service');
const returnService = require('../return.service');
const {
    Order, OrderItem, Product, UserShop, OrderReturn
} = require('../../entities');
const { AppError } = require('../../../utils/AppError');
const stockGuard = require('../../product/stock-status-guard.service');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Order Cancel → Inventory Sync', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        order = makeOrder();
        Order.findOne.mockResolvedValue(order);
        UserShop.findOne.mockResolvedValue({ id: 'us-1', is_active: true });
        OrderItem.findAll.mockResolvedValue(mockOrderItems);
        Product.findByPk.mockImplementation((id) => {
            if (id === 'prod-1') return Promise.resolve(mockProduct);
            return Promise.resolve({ ...mockProduct, id, track_quantity: false });
        });
    });

    it('calls Product.increment for tracked items when order is cancelled', async () => {
        await orderService.cancelOrder('order-1', 'user-1', 'shop-1');
        expect(Product.increment).toHaveBeenCalledWith(
            'quantity',
            expect.objectContaining({ by: 2, where: { id: 'prod-1' } })
        );
    });

    it('does NOT call Product.increment for non-tracked items', async () => {
        await orderService.cancelOrder('order-1', 'user-1', 'shop-1');
        // prod-2 has track_quantity: false — should not be incremented
        expect(Product.increment).not.toHaveBeenCalledWith(
            'quantity',
            expect.objectContaining({ where: { id: 'prod-2' } })
        );
    });

    it('updates order status to cancelled', async () => {
        await orderService.cancelOrder('order-1', 'user-1', 'shop-1');
        expect(order.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    });

    it('calls stock invalidate cache after restoring inventory', async () => {
        await orderService.cancelOrder('order-1', 'user-1', 'shop-1');
        expect(stockGuard.invalidate).toHaveBeenCalled();
    });

    it('throws 404 when order not found', async () => {
        Order.findOne.mockResolvedValue(null);
        await expect(
            orderService.cancelOrder('nonexistent', 'user-1', 'shop-1')
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 400 when order is already cancelled', async () => {
        Order.findOne.mockResolvedValue(makeOrder({ status: 'cancelled' }));
        await expect(
            orderService.cancelOrder('order-1', 'user-1', 'shop-1')
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('does not increment stock when order has no items', async () => {
        OrderItem.findAll.mockResolvedValue([]);
        await orderService.cancelOrder('order-1', 'user-1', 'shop-1');
        expect(Product.increment).not.toHaveBeenCalled();
    });
});

describe('Return Approval → Inventory Sync', () => {
    let mockReturn;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReturn = makeReturn();
        OrderReturn.findOne.mockResolvedValue(mockReturn);
        Order.findOne.mockResolvedValue(makeOrder());
        UserShop.findOne.mockResolvedValue({ id: 'us-1', is_active: true });
        Product.findByPk.mockResolvedValue(mockProduct);
    });

    it('calls Product.increment for returned items when status is approved', async () => {
        await returnService.updateReturnStatus('ret-1', 'approved', 'user-1', 'shop-1');
        expect(Product.increment).toHaveBeenCalledWith(
            'quantity',
            expect.objectContaining({ by: 2, where: { id: 'prod-1' } })
        );
    });

    it('does NOT call Product.increment when status is rejected', async () => {
        await returnService.updateReturnStatus('ret-1', 'rejected', 'user-1', 'shop-1');
        expect(Product.increment).not.toHaveBeenCalled();
    });

    it('updates return status to approved', async () => {
        await returnService.updateReturnStatus('ret-1', 'approved', 'user-1', 'shop-1');
        expect(mockReturn.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
    });

    it('calls stock invalidate cache after restoring inventory on approval', async () => {
        await returnService.updateReturnStatus('ret-1', 'approved', 'user-1', 'shop-1');
        expect(stockGuard.invalidate).toHaveBeenCalled();
    });

    it('throws 404 when return not found', async () => {
        OrderReturn.findOne.mockResolvedValue(null);
        await expect(
            returnService.updateReturnStatus('nonexistent', 'approved', 'user-1', 'shop-1')
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('only restores quantities for items listed in the return', async () => {
        // Return only has prod-1 (qty 2), not prod-2
        mockReturn = makeReturn({ items: [{ product_id: 'prod-1', quantity: 2 }] });
        OrderReturn.findOne.mockResolvedValue(mockReturn);
        await returnService.updateReturnStatus('ret-1', 'approved', 'user-1', 'shop-1');
        const calls = Product.increment.mock.calls.filter(c => c[1]?.where?.id === 'prod-2');
        expect(calls).toHaveLength(0);
    });
});
