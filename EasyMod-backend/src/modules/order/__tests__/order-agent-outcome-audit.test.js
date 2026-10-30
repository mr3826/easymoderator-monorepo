'use strict';

/**
 * IC-V1 review F3: a committed agent order must survive a failed Action Gate
 * result audit. The order row is already durable (stock deducted, merchant
 * notified); turning that into a 503 invites a retry against a committed
 * mutation. The creation returns with a result_unaudited marker instead, and
 * the failure path never masks the original error behind an audit failure.
 */

const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };

const mockOrder = { create: jest.fn() };
const mockOrderItem = { create: jest.fn() };
const mockProduct = { findAll: jest.fn() };
const mockCustomer = { findOne: jest.fn() };

const mockVerifyAuthorization = jest.fn(() => true);
const mockRecordActionGateOutcome = jest.fn(async () => ({ recorded: false, reasonCode: 'authorization_signature_invalid' }));

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
jest.mock('../../ai/action-gate', () => ({
    verifyAuthorization: (...args) => mockVerifyAuthorization(...args),
    recordActionGateOutcome: (...args) => mockRecordActionGateOutcome(...args),
}));

const orderService = require('../order.service');
const { sequelize } = require('../../../utils/database/database-setup');

const SHOP_ID = 'shop-1';

const makeProduct = () => ({
    id: 'prod-1',
    shop_id: SHOP_ID,
    name: 'Red Saree',
    price: '500.00',
    quantity: 10,
    track_quantity: false,
    allow_backorder: true,
});

const makeOrderData = () => ({
    customer_name: 'Rahim Uddin',
    customer_phone: '01711111111',
    payment_status: 'paid',
    channel: 'manual',
    items: [{ product_id: 'prod-1', quantity: 2 }],
});

const AUTHORIZATION = { actionType: 'CREATE_ORDER', shopId: SHOP_ID, idempotencyKey: 'k-1' };

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyAuthorization.mockReturnValue(true);
    mockRecordActionGateOutcome.mockResolvedValue({ recorded: false, reasonCode: 'authorization_signature_invalid' });
    sequelize.transaction.mockResolvedValue(mockTransaction);
    sequelize.query.mockResolvedValue([[{ next_number: 1 }]]);
    mockProduct.findAll.mockResolvedValue([makeProduct()]);
    mockOrderItem.create.mockResolvedValue({});
    mockOrder.create.mockImplementation((values) => Promise.resolve({
        ...values,
        id: 'order-1',
        save: jest.fn().mockResolvedValue(true),
    }));
});

describe('agent order result audit (IC-V1 review F3)', () => {
    test('a committed order survives a failed result audit and carries the unaudited marker', async () => {
        const order = await orderService.createOrderInternal(SHOP_ID, makeOrderData(), 'req-1', {
            authorization: AUTHORIZATION,
        });

        expect(order.id).toBe('order-1');
        expect(order.result_unaudited).toBe(true);
        expect(mockOrder.create).toHaveBeenCalledTimes(1);
        expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
    });

    test('the original tenant failure is never masked behind a failed failure-outcome audit', async () => {
        mockCustomer.findOne.mockResolvedValue(null);

        await expect(orderService.createOrderInternal(
            SHOP_ID,
            { ...makeOrderData(), customer_id: 'cust-other-shop' },
            'req-2',
            { authorization: AUTHORIZATION },
        )).rejects.toMatchObject({ status: 400, message: 'Customer does not belong to this shop' });
    });
});
