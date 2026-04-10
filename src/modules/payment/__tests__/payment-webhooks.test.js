const request = require('supertest');
const crypto = require('crypto');

// ── Set test env vars before anything loads ────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

// ── Mocks ──────────────────────────────────────────────────────────────

jest.mock('src/config/redis', () => ({
    sessionRedis: null, cacheRedis: null, rateLimitRedis: null, legacyRedis: null,
    closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({}))
}));

jest.mock('src/utils/redis-client', () => ({
    getRedisClient: () => null,
    isRedisAvailable: () => false,
    closeRedis: jest.fn()
}));

jest.mock('src/middleware/session.middleware', () => () => (req, res, next) => next());

const mockOrder = {
    id: 'order-1',
    order_number: 'ORD001',
    shop_id: 'shop-1',
    total: '1500.00',
    order_status: 'confirmed',
    payment_status: 'pending',
    customer_name: 'Test Customer',
    customer_phone: '01700000000',
    delivery_address: '123 Test St',
    update: jest.fn(() => Promise.resolve())
};

const mockPaymentConfig = {
    id: 'pc-1',
    shop_id: 'shop-1',
    gateway: 'sslcommerz',
    is_enabled: true,
    credentials: {
        store_id: 'test_store',
        store_password: 'test_pass'
    },
    config: { environment: 'sandbox' }
};

const mockAamarPayConfig = {
    id: 'pc-2',
    shop_id: 'shop-1',
    gateway: 'aamarpay',
    is_enabled: true,
    credentials: {
        store_id: 'aamar_store',
        secret_key: 'aamar_secret_key'
    },
    config: {}
};

function buildAamarPaySignedPayload(overrides = {}) {
    const base = {
        mer_txnid: 'ORD001-1706000000',
        pay_status: 'Successful',
        status_code: '2',
        amount: '1500.00',
        store_id: mockAamarPayConfig.credentials.store_id,
        ...overrides
    };

    const verifyKeys = ['mer_txnid', 'pay_status', 'status_code', 'amount', 'store_id'];
    const signaturePayload = verifyKeys
        .map((key) => `${key}=${base[key] ?? ''}`)
        .join('&');
    const verify_sign = crypto
        .createHmac('sha256', mockAamarPayConfig.credentials.secret_key)
        .update(`${signaturePayload}&signature_key=${mockAamarPayConfig.credentials.secret_key}`)
        .digest('hex');

    return {
        ...base,
        verify_key: verifyKeys.join(','),
        verify_sign
    };
}

const mockModel = {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(() => Promise.resolve([])),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    belongsTo: jest.fn(),
    hasMany: jest.fn(),
    hasOne: jest.fn(),
    belongsToMany: jest.fn(),
    addScope: jest.fn(),
    scope: jest.fn(function() { return this; }),
};

jest.mock('src/modules/entities', () => ({
    User: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() },
    Shop: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() },
    UserShop: { findOne: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    Order: { findOne: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    OrderItem: { ...mockModel },
    Product: { ...mockModel },
    Category: { ...mockModel },
    Customer: { ...mockModel },
    Channel: { ...mockModel },
    Conversation: { ...mockModel },
    Message: { ...mockModel },
    Keyword: { ...mockModel },
    AuditLog: { ...mockModel },
    IdempotencyKey: { ...mockModel },
    Subscription: { ...mockModel },
    Invoice: { ...mockModel },
    UsageEvent: { ...mockModel },
    PaymentConfig: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), belongsTo: jest.fn(), hasMany: jest.fn() },
    MetaIntegration: { ...mockModel },
    DeliveryIntegration: { ...mockModel },
    DeliveryCost: { ...mockModel },
    KnownArea: { ...mockModel },
    FaqResponse: { ...mockModel },
    BanglishDictionary: { ...mockModel },
    Analytics: { ...mockModel },
    OrderReturn: { ...mockModel },
    SupportTicket: { ...mockModel },
    Tenant: { ...mockModel },
}));

jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => ({ ...mockModel })),
        transaction: jest.fn(() => Promise.resolve({ commit: jest.fn(), rollback: jest.fn() })),
        authenticate: jest.fn(() => Promise.resolve()),
        sync: jest.fn(() => Promise.resolve()),
    }
}));

jest.mock('src/utils/password.util', () => ({
    hashPassword: jest.fn((p) => Promise.resolve(`hashed_${p}`)),
    comparePassword: jest.fn(() => Promise.resolve(false))
}));

jest.mock('src/utils/workflow-client', () => ({
    postToWorkflow: jest.fn(() => Promise.resolve({}))
}));

jest.mock('axios');
const axios = require('axios');

const { Order, PaymentConfig } = require('src/modules/entities');

// ── Tests ──────────────────────────────────────────────────────────────

describe('Payment Webhook Handlers', () => {
    let app;

    beforeAll(() => {
        process.env.FRONTEND_URL = 'http://localhost:5173';
        app = require('src/app');
    });

    beforeEach(() => {
        jest.clearAllMocks();
        PaymentConfig.findOne.mockImplementation(({ where }) => {
            if (where?.gateway === 'aamarpay') return Promise.resolve(mockAamarPayConfig);
            if (where?.gateway === 'sslcommerz') return Promise.resolve(mockPaymentConfig);
            return Promise.resolve(null);
        });
    });

    // ── AamarPay Webhooks ───────────────────────────────────────────────

    describe('AamarPay Callbacks', () => {
        describe('POST /api/payment/aamarpay/success', () => {
            it('should mark order as paid and redirect on successful payment', async () => {
                Order.findOne.mockResolvedValue({ ...mockOrder, update: jest.fn() });

                const res = await request(app)
                    .post('/api/payment/aamarpay/success')
                    .send(buildAamarPaySignedPayload({ cus_name: 'Test Customer' }));

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=success');
                expect(res.headers.location).toContain('order=ORD001');
            });

            it('should mark order as failed when payment was not successful', async () => {
                const orderUpdate = jest.fn();
                Order.findOne.mockResolvedValue({ ...mockOrder, update: orderUpdate });

                const res = await request(app)
                    .post('/api/payment/aamarpay/success')
                    .send(buildAamarPaySignedPayload({ pay_status: 'Failed', status_code: '7' }));

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=failed');
                expect(orderUpdate).toHaveBeenCalledWith({ payment_status: 'failed' });
            });

            it('should redirect to error page when order not found', async () => {
                Order.findOne.mockResolvedValue(null);

                const res = await request(app)
                    .post('/api/payment/aamarpay/success')
                    .send({
                        mer_txnid: 'NONEXIST-1706000000',
                        pay_status: 'Successful',
                        status_code: '2'
                    });

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=error');
            });
        });

        describe('POST /api/payment/aamarpay/fail', () => {
            it('should mark order as failed and redirect', async () => {
                const orderUpdate = jest.fn();
                Order.findOne.mockResolvedValue({ ...mockOrder, update: orderUpdate });

                const res = await request(app)
                    .post('/api/payment/aamarpay/fail')
                    .send(buildAamarPaySignedPayload({ pay_status: 'Failed', status_code: '7' }));

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=failed');
            });
        });

        describe('POST /api/payment/aamarpay/cancel', () => {
            it('should handle cancellation and redirect', async () => {
                const orderUpdate = jest.fn();
                Order.findOne.mockResolvedValue({ ...mockOrder, update: orderUpdate });

                const res = await request(app)
                    .post('/api/payment/aamarpay/cancel')
                    .send(buildAamarPaySignedPayload({ pay_status: 'Cancelled', status_code: '7' }));

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=failed');
            });
        });
    });

    // ── SSLCommerz Webhooks ─────────────────────────────────────────────

    describe('SSLCommerz Callbacks', () => {
        describe('POST /api/payment/sslcommerz/success', () => {
            it('should validate with SSLCommerz API and mark as paid', async () => {
                Order.findOne.mockResolvedValue({ ...mockOrder, update: jest.fn() });
                PaymentConfig.findOne.mockResolvedValue(mockPaymentConfig);

                // Mock SSLCommerz validation API
                axios.get.mockResolvedValue({
                    data: { status: 'VALID', tran_id: 'ORD001-1706000000' }
                });

                const res = await request(app)
                    .post('/api/payment/sslcommerz/success')
                    .send({
                        tran_id: 'ORD001-1706000000',
                        val_id: 'VAL123456',
                        status: 'VALID',
                        shop_id: 'shop-1',
                        amount: '1500.00'
                    });

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=success');
            });

            it('should mark as failed when validation fails', async () => {
                const orderUpdate = jest.fn();
                Order.findOne.mockResolvedValue({ ...mockOrder, update: orderUpdate });
                PaymentConfig.findOne.mockResolvedValue(mockPaymentConfig);

                axios.get.mockResolvedValue({
                    data: { status: 'INVALID' }
                });

                const res = await request(app)
                    .post('/api/payment/sslcommerz/success')
                    .send({
                        tran_id: 'ORD001-1706000000',
                        val_id: 'VAL_BAD',
                        status: 'VALID',
                        shop_id: 'shop-1'
                    });

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=failed');
            });
        });

        describe('POST /api/payment/sslcommerz/fail', () => {
            it('should handle failure callback', async () => {
                const orderUpdate = jest.fn();
                Order.findOne.mockResolvedValue({ ...mockOrder, update: orderUpdate });
                PaymentConfig.findOne.mockResolvedValue(mockPaymentConfig);

                const res = await request(app)
                    .post('/api/payment/sslcommerz/fail')
                    .send({
                        tran_id: 'ORD001-1706000000',
                        status: 'FAILED',
                        shop_id: 'shop-1'
                    });

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=failed');
            });
        });

        describe('POST /api/payment/sslcommerz/ipn', () => {
            it('should return JSON response for IPN callback', async () => {
                Order.findOne.mockResolvedValue({ ...mockOrder, update: jest.fn() });
                PaymentConfig.findOne.mockResolvedValue(mockPaymentConfig);

                axios.get.mockResolvedValue({
                    data: { status: 'VALID' }
                });

                const res = await request(app)
                    .post('/api/payment/sslcommerz/ipn')
                    .send({
                        tran_id: 'ORD001-1706000000',
                        val_id: 'VAL123456',
                        status: 'VALID',
                        shop_id: 'shop-1'
                    });

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.message).toBe('Payment verified');
            });

            it('should return failure for invalid IPN', async () => {
                Order.findOne.mockResolvedValue(null);

                const res = await request(app)
                    .post('/api/payment/sslcommerz/ipn')
                    .send({
                        tran_id: 'NONEXIST-1706000000',
                        status: 'VALID',
                        shop_id: 'shop-1'
                    });

                expect(res.status).toBe(400);
                expect(res.body.success).toBe(false);
            });
        });

        describe('POST /api/payment/sslcommerz/cancel', () => {
            it('should handle SSLCommerz cancellation', async () => {
                const orderUpdate = jest.fn();
                Order.findOne.mockResolvedValue({ ...mockOrder, update: orderUpdate });
                PaymentConfig.findOne.mockResolvedValue(mockPaymentConfig);

                const res = await request(app)
                    .post('/api/payment/sslcommerz/cancel')
                    .send({
                        tran_id: 'ORD001-1706000000',
                        status: 'CANCELLED',
                        shop_id: 'shop-1'
                    });

                expect(res.status).toBe(302);
                expect(res.headers.location).toContain('payment=failed');
            });
        });
    });

    // ── Edge cases ──────────────────────────────────────────────────────

    describe('Edge Cases', () => {
        it('should handle missing transaction ID in AamarPay callback', async () => {
            const res = await request(app)
                .post('/api/payment/aamarpay/success')
                .send({ pay_status: 'Successful' });

            expect(res.status).toBe(302);
            expect(res.headers.location).toContain('payment=error');
        });

        it('should handle missing transaction ID in SSLCommerz IPN', async () => {
            const res = await request(app)
                .post('/api/payment/sslcommerz/ipn')
                .send({ status: 'VALID', shop_id: 'shop-1' });

            expect(res.status).toBe(400);
        });

        it('should handle SSLCommerz validation API failure gracefully', async () => {
            const orderUpdate = jest.fn();
            Order.findOne.mockResolvedValue({ ...mockOrder, update: orderUpdate });
            PaymentConfig.findOne.mockResolvedValue(mockPaymentConfig);

            axios.get.mockRejectedValue(new Error('Network error'));

            const res = await request(app)
                .post('/api/payment/sslcommerz/ipn')
                .send({
                    tran_id: 'ORD001-1706000000',
                    val_id: 'VAL123',
                    status: 'VALID',
                    shop_id: 'shop-1'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
        });
    });
});
