'use strict';

/**
 * Tech Debt #7 regression: _createOrderCore must reject an orderData.customer_id
 * that does not exist or belongs to a different shop (cross-shop tenant
 * assignment). Pure unit tier — exercises the shared core via the internal
 * (chatbot/automated) entry point, same as the user-auth path.
 */

const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };

const mockOrder = { create: jest.fn() };
const mockOrderItem = { create: jest.fn() };
const mockProduct = { findAll: jest.fn() };
const mockCustomer = { findOne: jest.fn() };

jest.mock('../../entities', () => ({
    Order: mockOrder,
    OrderItem: mockOrderItem,
    Product: mockProduct,
    Customer: mockCustomer,
    UserShop: {},
    OrderReturn: {},
    CourierDispatch: {},
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(),
        query: jest.fn(),
        getDialect: jest.fn().mockReturnValue('postgres'),
    },
}));
jest.mock('../../subscription/subscription.service', () => ({
    checkOrderLimit: jest.fn().mockResolvedValue(true),
    trackUsage: jest.fn().mockResolvedValue({ transactionId: 'txn-1' }),
}));
jest.mock('../order-idempotency.service', () => ({
    findOrderByIdempotencyKey: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../product/stock-status-guard.service', () => ({ invalidate: jest.fn() }));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnThis(),
    }),
}));
jest.mock('../../delivery/delivery.service', () => ({}));
jest.mock('../../delivery/courier-dispatch-claim.service', () => ({}));
jest.mock('../../customer-intelligence/opportunity.service', () => ({
    convertForOrder: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../analytics/funnel-events.service', () => ({
    recordInternalFunnelEvent: jest.fn().mockResolvedValue({ recorded: false }),
}));

const orderService = require('../order.service');
const { sequelize } = require('../../../utils/database/database-setup');
const subscriptionService = require('../../subscription/subscription.service');
const opportunityService = require('../../customer-intelligence/opportunity.service');

const SHOP_ID = 'shop-1';

const makeProduct = (overrides = {}) => ({
    id: 'prod-1',
    shop_id: SHOP_ID,
    name: 'Red Saree',
    price: '500.00',
    quantity: 10,
    track_quantity: false,
    allow_backorder: true,
    ...overrides,
});

// payment_status 'paid' keeps the order out of the COD/RTO-Shield pre-check so
// these tests isolate the customer_id tenant guard.
const makeOrderData = (overrides = {}) => ({
    customer_name: 'Rahim Uddin',
    customer_phone: '01711111111',
    payment_status: 'paid',
    channel: 'manual',
    items: [{ product_id: 'prod-1', quantity: 2 }],
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockResolvedValue(mockTransaction);
    mockTransaction.commit.mockResolvedValue(undefined);
    mockTransaction.rollback.mockResolvedValue(undefined);
    sequelize.query.mockResolvedValue([[{ next_number: 1 }]]);
    mockProduct.findAll.mockResolvedValue([makeProduct()]);
    mockOrderItem.create.mockResolvedValue({});
    mockOrder.create.mockImplementation((values) => Promise.resolve({
        ...values,
        id: 'order-1',
        save: jest.fn().mockResolvedValue(true),
    }));
});

describe('_createOrderCore customer_id tenant integrity (Tech Debt #7)', () => {
    test('accepts a customer_id that belongs to the order\'s shop', async () => {
        mockCustomer.findOne.mockResolvedValue({ id: 'cust-1', shop_id: SHOP_ID });

        const order = await orderService.createOrderInternal(SHOP_ID, makeOrderData({ customer_id: 'cust-1' }));

        expect(mockCustomer.findOne).toHaveBeenCalledWith({
            where: { id: 'cust-1', shop_id: SHOP_ID },
            transaction: mockTransaction,
        });
        expect(mockOrder.create).toHaveBeenCalledWith(
            expect.objectContaining({ shop_id: SHOP_ID, customer_id: 'cust-1' }),
            { transaction: mockTransaction },
        );
        expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
        expect(order.customer_id).toBe('cust-1');
        expect(opportunityService.convertForOrder).toHaveBeenCalled();
    });

    test('rejects a customer_id belonging to a different shop with 400', async () => {
        // Tenant-scoped query returns null for a cross-shop customer id.
        mockCustomer.findOne.mockResolvedValue(null);

        await expect(
            orderService.createOrderInternal(SHOP_ID, makeOrderData({ customer_id: 'cust-other-shop' })),
        ).rejects.toMatchObject({
            name: 'AppError',
            status: 400,
            message: 'Customer does not belong to this shop',
        });

        expect(mockCustomer.findOne).toHaveBeenCalledWith({
            where: { id: 'cust-other-shop', shop_id: SHOP_ID },
            transaction: mockTransaction,
        });
        expect(mockOrder.create).not.toHaveBeenCalled();
        expect(mockTransaction.rollback).toHaveBeenCalledTimes(1);
        expect(mockTransaction.commit).not.toHaveBeenCalled();
        expect(subscriptionService.trackUsage).not.toHaveBeenCalled();
    });

    test('rejects a non-existent customer_id with 400', async () => {
        mockCustomer.findOne.mockResolvedValue(null);

        await expect(
            orderService.createOrderInternal(SHOP_ID, makeOrderData({ customer_id: 'cust-missing' })),
        ).rejects.toMatchObject({
            name: 'AppError',
            status: 400,
            message: 'Customer does not belong to this shop',
        });

        expect(mockOrder.create).not.toHaveBeenCalled();
        expect(mockTransaction.rollback).toHaveBeenCalledTimes(1);
    });

    test('creates the order without a customer_id (regression guard)', async () => {
        const order = await orderService.createOrderInternal(SHOP_ID, makeOrderData());

        expect(mockCustomer.findOne).not.toHaveBeenCalled();
        expect(mockOrder.create).toHaveBeenCalledWith(
            expect.objectContaining({ shop_id: SHOP_ID, customer_id: undefined }),
            { transaction: mockTransaction },
        );
        expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
        expect(order).toEqual(expect.objectContaining({ id: 'order-1', shop_id: SHOP_ID }));
    });
});
