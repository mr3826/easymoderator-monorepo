const request = require('supertest');

// ── Set test env vars before anything loads ────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

// ── Mock Redis ─────────────────────────────────────────────────────────
const redisStore = {};
const mockRedis = {
    get: jest.fn((key) => Promise.resolve(redisStore[key] || null)),
    set: jest.fn((key, val, ...args) => { redisStore[key] = val; return Promise.resolve('OK'); }),
    setex: jest.fn((key, ttl, val) => { redisStore[key] = val; return Promise.resolve('OK'); }),
    del: jest.fn((key) => { delete redisStore[key]; return Promise.resolve(1); }),
    incr: jest.fn((key) => {
        redisStore[key] = (parseInt(redisStore[key], 10) || 0) + 1;
        return Promise.resolve(redisStore[key]);
    }),
    expire: jest.fn(() => Promise.resolve(1)),
    ttl: jest.fn(() => Promise.resolve(900)),
    status: 'ready'
};

jest.mock('src/utils/redis-client', () => ({
    getRedisClient: () => mockRedis,
    isRedisAvailable: () => true,
    closeRedis: jest.fn()
}));

// ── Mock Sequelize (must support .define() for entity files) ───────────
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
    scope: jest.fn(() => mockModel),
};

jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => ({ ...mockModel })),
        transaction: jest.fn(() => Promise.resolve({
            commit: jest.fn(),
            rollback: jest.fn()
        })),
        authenticate: jest.fn(() => Promise.resolve()),
        sync: jest.fn(() => Promise.resolve()),
    }
}));

// ── Mock entities (override define-based models) ───────────────────────
const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    password: '$2a$10$hashedpassword',
    full_name: 'Test User',
    phone: null,
    profile_picture: null,
    refresh_token: null,
    last_logged_shop_id: 'shop-1',
    update: jest.fn(() => Promise.resolve()),
    shops: [{
        id: 'shop-1',
        unique_code: 'ABC12',
        shop_name: 'Test Shop',
        UserShop: { role: 'owner', is_active: true }
    }]
};

jest.mock('src/modules/entities', () => ({
    User: {
        findOne: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
        belongsTo: jest.fn(),
        hasMany: jest.fn(),
        hasOne: jest.fn(),
        belongsToMany: jest.fn(),
    },
    Shop: {
        findOne: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
        belongsTo: jest.fn(),
        hasMany: jest.fn(),
        hasOne: jest.fn(),
        belongsToMany: jest.fn(),
    },
    UserShop: {
        findOne: jest.fn(),
        create: jest.fn(),
        belongsTo: jest.fn(),
        hasMany: jest.fn(),
    },
    Order: { ...mockModel },
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
    PaymentConfig: { ...mockModel },
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

jest.mock('src/utils/password.util', () => ({
    hashPassword: jest.fn((p) => Promise.resolve(`hashed_${p}`)),
    comparePassword: jest.fn((plain, hashed) => Promise.resolve(plain === 'correct-password'))
}));

// Mock session middleware to no-op
jest.mock('src/middleware/session.middleware', () => () => (req, res, next) => next());

// Mock workflow client
jest.mock('src/utils/workflow-client', () => ({
    postToWorkflow: jest.fn(() => Promise.resolve({}))
}));

const { User } = require('src/modules/entities');

// ── Tests ──────────────────────────────────────────────────────────────

describe('Auth API', () => {
    let app;

    beforeAll(() => {
        // require app AFTER mocks are in place
        app = require('src/app');
    });

    beforeEach(() => {
        // Clear redis store between tests
        Object.keys(redisStore).forEach(k => delete redisStore[k]);
        // Reset call counts but keep implementations
        mockRedis.get.mockClear();
        mockRedis.set.mockClear();
        mockRedis.setex.mockClear();
        mockRedis.del.mockClear();
        mockRedis.incr.mockClear();
        mockRedis.expire.mockClear();
        mockRedis.ttl.mockClear();
        mockUser.update.mockClear();
    });

    // ── Signup ──────────────────────────────────────────────────────────

    describe('POST /api/auth/signup', () => {
        it('should return 400 when email is missing', async () => {
            const res = await request(app)
                .post('/api/auth/signup')
                .send({ password: '123456' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should return 400 when password is too short', async () => {
            const res = await request(app)
                .post('/api/auth/signup')
                .send({ email: 'test@example.com', password: '123' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    // ── Signin ──────────────────────────────────────────────────────────

    describe('POST /api/auth/signin', () => {
        it('should return 401 for invalid credentials', async () => {
            User.findOne.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/auth/signin')
                .send({ email: 'wrong@example.com', password: 'wrong' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('should return 200 and set httpOnly cookies on valid login', async () => {
            User.findOne.mockResolvedValue(mockUser);

            const res = await request(app)
                .post('/api/auth/signin')
                .send({ email: 'test@example.com', password: 'correct-password' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.tokens.access_token).toBeDefined();
            expect(res.body.data.tokens.refresh_token).toBeDefined();

            // Verify httpOnly cookies are set
            const cookies = res.headers['set-cookie'];
            expect(cookies).toBeDefined();
            const cookieStr = cookies.join('; ');
            expect(cookieStr).toContain('access_token=');
            expect(cookieStr).toContain('HttpOnly');
        });

        it('should return 400 when email is missing', async () => {
            const res = await request(app)
                .post('/api/auth/signin')
                .send({ password: 'test123' });

            expect(res.status).toBe(400);
        });
    });

    // ── Account Lockout ─────────────────────────────────────────────────

    describe('Account Lockout', () => {
        it('should lock account after 5 failed attempts', async () => {
            User.findOne.mockResolvedValue(null); // always fail

            // Make 5 failed attempts
            for (let i = 0; i < 5; i++) {
                await request(app)
                    .post('/api/auth/signin')
                    .send({ email: 'lockme@example.com', password: 'wrong' });
            }

            // 6th attempt should get lockout message
            const res = await request(app)
                .post('/api/auth/signin')
                .send({ email: 'lockme@example.com', password: 'wrong' });

            expect(res.status).toBe(429);
            expect(res.body.error.message).toContain('temporarily locked');
        });
    });

    // ── Logout ──────────────────────────────────────────────────────────

    describe('POST /api/auth/logout', () => {
        let validToken;

        // Helper: get a valid access token
        const loginAndGetToken = async () => {
            User.findOne.mockResolvedValue(mockUser);
            const loginRes = await request(app)
                .post('/api/auth/signin')
                .send({ email: 'logout-test@example.com', password: 'correct-password' });
            return loginRes.body.data.tokens.access_token;
        };

        it('should return 401 without a token', async () => {
            const res = await request(app).post('/api/auth/logout');
            expect(res.status).toBe(401);
        });

        it('should return 200 and blacklist token on valid logout', async () => {
            validToken = await loginAndGetToken();
            User.findByPk.mockResolvedValue(mockUser);

            const logoutRes = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${validToken}`);

            expect(logoutRes.status).toBe(200);
            expect(logoutRes.body.message).toBe('Logged out successfully');

            // Verify the token is blacklisted in our mock Redis
            expect(mockRedis.setex).toHaveBeenCalledWith(
                expect.stringContaining('token_blacklist:'),
                expect.any(Number),
                '1'
            );
        });

        it('should reject requests with a blacklisted token', async () => {
            validToken = await loginAndGetToken();
            User.findByPk.mockResolvedValue(mockUser);

            // Logout (blacklists the token)
            await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${validToken}`);

            // Try to use the same token — should be rejected
            const res = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${validToken}`);

            expect(res.status).toBe(401);
        });
    });

    // ── Refresh ─────────────────────────────────────────────────────────

    describe('POST /api/auth/refresh', () => {
        it('should return 400 when refresh_token is missing', async () => {
            const res = await request(app)
                .post('/api/auth/refresh')
                .send({ refresh_token: '' });

            // express-validator will reject empty refresh_token
            expect(res.status).toBe(400);
        });
    });
});
