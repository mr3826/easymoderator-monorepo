'use strict';

const mockModels = {
    AuditLog: { create: jest.fn() },
    Order: { findOne: jest.fn() },
    OwnerNotification: { findByPk: jest.fn() },
    PaymentTransaction: { findOne: jest.fn() },
    Shop: {},
    User: {},
    UserShop: {},
};
const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockSequelize = {
    transaction: jest.fn(async (callback) => callback(mockTransaction)),
};

jest.mock('../../entities', () => mockModels);
jest.mock('../../../utils/database/database-setup', () => ({ sequelize: mockSequelize }));
jest.mock('../../../utils/email.service', () => ({ sendEmail: jest.fn() }));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const service = require('../owner-notification.service');

function fixtures(overrides = {}) {
    const notification = {
        id: 'notification-1',
        shop_id: 'shop-1',
        type: 'payment_confirmation',
        status: 'pending',
        expires_at: new Date(Date.now() + 60_000),
        customer_data: {
            orderId: 'order-1',
            orderNumber: 'ORD-1',
            transactionId: 'trx-1',
        },
        update: jest.fn(),
        ...overrides.notification,
    };
    const order = {
        id: 'order-1',
        shop_id: 'shop-1',
        customer_id: null,
        update: jest.fn(),
        ...overrides.order,
    };
    const payment = {
        id: 'payment-1',
        status: 'pending',
        update: jest.fn(),
        ...overrides.payment,
    };
    mockModels.OwnerNotification.findByPk.mockResolvedValue(notification);
    mockModels.Order.findOne.mockResolvedValue(order);
    mockModels.PaymentTransaction.findOne.mockResolvedValue(payment);
    mockModels.AuditLog.create.mockResolvedValue({});
    return { notification, order, payment };
}

describe('authenticated owner payment confirmation state machine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(service, 'sendCustomerResponse').mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('approves one pending shop-scoped payment and appends an audit event', async () => {
        const { notification, order, payment } = fixtures();

        await expect(service.handleOwnerResponse(
            notification.id,
            'approve',
            { userId: 'owner-1' },
        )).resolves.toMatchObject({ success: true, orderId: order.id });

        expect(mockModels.Order.findOne).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: order.id, shop_id: notification.shop_id },
        }));
        expect(order.update).toHaveBeenCalledWith(
            expect.objectContaining({ payment_status: 'paid', order_status: 'confirmed' }),
            { transaction: mockTransaction },
        );
        expect(payment.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'verified' }),
            { transaction: mockTransaction },
        );
        expect(mockModels.AuditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'owner_payment_approve',
                shop_id: notification.shop_id,
                user_id: 'owner-1',
            }),
            { transaction: mockTransaction },
        );
    });

    test('rejects one pending payment without approving it', async () => {
        const { notification, order, payment } = fixtures();

        await service.handleOwnerResponse(notification.id, 'reject', { userId: 'owner-1' });

        expect(order.update).toHaveBeenCalledWith(
            { payment_status: 'failed', order_status: 'cancelled' },
            { transaction: mockTransaction },
        );
        expect(payment.update).toHaveBeenCalledWith(
            { status: 'rejected' },
            { transaction: mockTransaction },
        );
    });

    test.each([
        ['replayed completion', { notification: { status: 'completed' } }, 409],
        ['expired action', { notification: { expires_at: new Date(Date.now() - 60_000) } }, 410],
        ['completed payment transition', { payment: { status: 'paid' } }, 409],
    ])('rejects %s', async (_label, overrides, status) => {
        const { notification } = fixtures(overrides);

        await expect(service.handleOwnerResponse(
            notification.id,
            'approve',
            { userId: 'owner-1' },
        )).rejects.toMatchObject({ status });
    });

    test('rejects a forged action before reading tenant data', async () => {
        await expect(service.handleOwnerResponse(
            'notification-1',
            'refund',
            { userId: 'owner-1' },
        )).rejects.toMatchObject({ status: 400 });
        expect(mockModels.OwnerNotification.findByPk).not.toHaveBeenCalled();
    });
});
