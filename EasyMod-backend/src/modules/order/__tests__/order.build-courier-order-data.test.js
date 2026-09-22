/**
 * buildCourierOrderData — COD/collection amount tests
 *
 * Production defect: buildCourierOrderData always set cod_amount (and left
 * `total` as the sole fallback every provider adapter reads for cash to
 * collect) to the full order total, regardless of order.payment_status.
 * A customer who already paid online (bKash/Nagad/card -> payment_status
 * 'paid') was therefore still invoiced the full order total as
 * cash-on-delivery by every courier.
 */

// Mock entities before requiring service (mirrors order.service.test.js).
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

const { buildCourierOrderData } = require('../order.service');

const baseOrder = (overrides = {}) => ({
    id: 'order-1',
    order_number: 'ORD-TEST-0001',
    customer_name: 'Rahim',
    customer_phone: '01711111111',
    delivery_address: {
        street_address: 'Road 1',
        upazila: 'Dhanmondi',
        district: 'Dhaka',
    },
    total: 1500,
    items: [{ name: 'Red Saree', quantity: 1 }],
    ...overrides,
});

describe('buildCourierOrderData — COD collection amount by payment status', () => {
    test('prepaid order (payment_status: "paid") must not be re-collected as COD', () => {
        const order = baseOrder({ payment_status: 'paid' });

        const orderData = buildCourierOrderData(order);

        expect(orderData.cod_amount).toBe(0);
        expect(orderData.amount_to_collect).toBe(0);
        // The true order value is still reported (e.g. for courier declared value).
        expect(orderData.total).toBe(1500);
    });

    test('unpaid order still collects the full total as COD (no regression)', () => {
        const order = baseOrder({ payment_status: 'unpaid' });

        const orderData = buildCourierOrderData(order);

        expect(orderData.cod_amount).toBe(1500);
        expect(orderData.amount_to_collect).toBe(1500);
        expect(orderData.total).toBe(1500);
    });

    test('order with no payment_status set defaults to full COD collection (legacy/manual orders)', () => {
        const order = baseOrder();
        delete order.payment_status;

        const orderData = buildCourierOrderData(order);

        expect(orderData.cod_amount).toBe(1500);
        expect(orderData.amount_to_collect).toBe(1500);
    });

    test('partially_paid order collects the full total (no due-balance field exists on the Order model)', () => {
        const order = baseOrder({ payment_status: 'partially_paid' });

        const orderData = buildCourierOrderData(order);

        expect(orderData.cod_amount).toBe(1500);
        expect(orderData.amount_to_collect).toBe(1500);
    });
});
