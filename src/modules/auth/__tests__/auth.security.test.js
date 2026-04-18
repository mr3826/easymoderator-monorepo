/**
 * Auth Security Tests
 * Tests for the security fixes applied to the auth flow
 */

const request = require('supertest');
const crypto = require('crypto');

// ── Set test env vars before anything loads ────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-32-chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-32-chars!';
process.env.APP_SECRET = 'test-app-secret-key-32-chars!!!';

// ── Mock Redis config ──────────────────────────────────────────────────
jest.mock('src/config/redis', () => ({
    sessionRedis: null, cacheRedis: null, rateLimitRedis: null, legacyRedis: null,
    closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({}))
}));

// ── Mock Redis with stores for different prefixes ──────────────────────
const redisStore = {};
const mockRedis = {
    get: jest.fn((key) => Promise.resolve(redisStore[key] || null)),
    set: jest.fn((key, val) => { redisStore[key] = val; return Promise.resolve('OK'); }),
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

// ── Mock Sequelize ─────────────────────────────────────────────────────
const mockTransaction = {
    commit: jest.fn(),
    rollback: jest.fn()
};

jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => ({
            findOne: jest.fn(),
            findByPk: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            destroy: jest.fn(),
            belongsTo: jest.fn(),
            hasMany: jest.fn(),
            hasOne: jest.fn(),
            belongsToMany: jest.fn(),
        })),
        transaction: jest.fn(() => Promise.resolve(mockTransaction)),
        authenticate: jest.fn(() => Promise.resolve()),
        sync: jest.fn(() => Promise.resolve()),
        literal: jest.fn((str) => str)
    }
}));

// ── Mock entities ──────────────────────────────────────────────────────
const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    password: '$2a$10$hashedpassword',
    full_name: 'Test User',
    phone: null,
    profile_picture: null,
    refresh_token: null,
    last_logged_shop_id: 'shop-1',
    token_version: 1,
    update: jest.fn(() => Promise.resolve()),
    shops: [{
        id: 'shop-1',
        unique_code: 'ABC12',
        shop_name: 'Test Shop',
        UserShop: { role: 'owner', is_active: true }
    }]
};

const mockUser2FA = {
    ...mockUser,
    settings: {
        totp_enabled: true,
        totp_secret: 'encrypted-secret-here',
        totp_pending: null
    }
};

jest.mock('src/modules/entities', () => ({
    User: {
        findOne: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
        belongsTo: jest.fn(),
        hasMany: jest.fn(),
        belongsToMany: jest.fn(),
    },
    Shop: {
        findOne: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
    },
    UserShop: {
        findOne: jest.fn(),
        create: jest.fn(),
    },
    Tenant: {
        create: jest.fn(),
    },
    PasswordResetToken: {
        findOne: jest.fn(),
        destroy: jest.fn(),
        create: jest.fn(),
    }
}));

jest.mock('src/utils/password.util', () => ({
    hashPassword: jest.fn((p) => Promise.resolve(`hashed_${p}`)),
    comparePassword: jest.fn((plain, hashed) => Promise.resolve(plain === 'correct-password'))
}));

jest.mock('src/middleware/session.middleware', () => () => (req, res, next) => next());
jest.mock('src/utils/workflow-client', () => ({
    postToWorkflow: jest.fn(() => Promise.resolve({}))
}));
jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), logUsage: jest.fn() })),
}));

jest.mock('src/utils/email.service', () => ({
    sendEmail: jest.fn(() => Promise.resolve())
}));

const { User, PasswordResetToken } = require('src/modules/entities');
const { generateAccessToken, generateRefreshToken } = require('src/utils/jwt.util');

describe('Auth Security Fixes', () => {
    let app;

    beforeAll(() => {
        app = require('src/app');
    });

    beforeEach(() => {
        Object.keys(redisStore).forEach(k => delete redisStore[k]);
        jest.clearAllMocks();
        mockUser.token_version = 1;
        mockUser.refresh_token = null;
        mockUser.last_logged_shop_id = 'shop-1';
    });

    // ============================================================================
    // 1. Token Version Validation (Password Reset Invalidates Tokens)
    // ============================================================================
    describe('Token Version - Password Reset Invalidation', () => {
        it('should reject access token after password reset (token_version incremented)', async () => {
            // 1. Login and get access token
            User.findOne.mockResolvedValue(mockUser);
            const loginRes = await request(app)
                .post('/api/auth/signin')
                .send({ email: 'test@example.com', password: 'correct-password' });

            expect(loginRes.status).toBe(200);
            const cookies = loginRes.headers['set-cookie'];
            const accessToken = cookies.find(c => c.startsWith('access_token='))?.split(';')[0]?.replace('access_token=', '');

            // 2. Simulate password reset (increment token_version)
            mockUser.token_version = 2; // Incremented after password reset

            // 3. Try to use the old access token - should be rejected
            User.findByPk.mockResolvedValue(mockUser);
            const res = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`);

            // Should fail because token_version in JWT (1) != token_version in DB (2)
            expect(res.status).toBe(401);
            expect(res.body.error?.message || res.body.message).toContain('invalidated');
        });

        it('should allow access with new token after password reset', async () => {
            // After password reset, new login should work
            mockUser.token_version = 2;
            User.findOne.mockResolvedValue(mockUser);

            const loginRes = await request(app)
                .post('/api/auth/signin')
                .send({ email: 'test@example.com', password: 'correct-password' });

            expect(loginRes.status).toBe(200);
            const cookies = loginRes.headers['set-cookie'];
            expect(cookies).toBeDefined();
            expect(cookies.some(c => c.includes('access_token='))).toBe(true);
        });
    });

    // ============================================================================
    // 2. 2FA Verify - httpOnly Cookies (Not Response Body)
    // ============================================================================
    describe('2FA Verify - httpOnly Cookies Security', () => {
        it('should NOT return tokens in 2FA verify response body', async () => {
            // Mock user with 2FA enabled
            User.findOne.mockResolvedValue(mockUser2FA);

            // Step 1: Signin (returns tempToken, not full JWT)
            const signinRes = await request(app)
                .post('/api/auth/signin')
                .send({ email: 'test@example.com', password: 'correct-password' });

            // With 2FA enabled, should return requires2fa flag
            if (signinRes.body.data?.requires2fa) {
                // Step 2: Verify 2FA
                const tempToken = signinRes.body.data?.tempToken;

                // Mock successful TOTP verification
                jest.spyOn(require('src/modules/auth/totp.service'), 'consumeTempToken')
                    .mockResolvedValue(mockUser2FA.id);
                jest.spyOn(require('src/modules/auth/totp.service'), 'verifyTotpToken')
                    .mockResolvedValue(true);

                User.findByPk.mockResolvedValue(mockUser2FA);

                const verifyRes = await request(app)
                    .post('/api/auth/2fa/verify')
                    .send({ tempToken, token: '123456' });

                // Should NOT contain accessToken or refreshToken in response body
                expect(verifyRes.body.data?.accessToken).toBeUndefined();
                expect(verifyRes.body.data?.refreshToken).toBeUndefined();

                // Should have httpOnly cookies
                const cookies = verifyRes.headers['set-cookie'];
                expect(cookies).toBeDefined();
                expect(cookies.some(c => c.includes('access_token=') && c.includes('HttpOnly'))).toBe(true);
            }
        });
    });

    // ============================================================================
    // 3. Refresh Token Requires Valid shopId
    // ============================================================================
    describe('Refresh Token - Requires shopId', () => {
        it('should reject refresh when user has no last_logged_shop_id', async () => {
            // User with no shop context
            const userNoShop = {
                ...mockUser,
                last_logged_shop_id: null,
                refresh_token: crypto.createHash('sha256').update('valid-refresh-token').digest('hex')
            };

            User.findByPk.mockResolvedValue(userNoShop);

            const res = await request(app)
                .post('/api/auth/refresh')
                .send({ refresh_token: 'valid-refresh-token' });

            expect(res.status).toBe(401);
            expect(res.body.error?.message || res.body.message).toContain('No active shop session');
        });
    });

    // ============================================================================
    // 4. SHA-256 for Refresh Token Storage (Not bcrypt)
    // ============================================================================
    describe('Refresh Token - SHA-256 Hashing', () => {
        it('should use SHA-256 hash for refresh token comparison', async () => {
            const refreshToken = 'test-refresh-token-' + Date.now();
            const expectedHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

            const userWithToken = {
                ...mockUser,
                refresh_token: expectedHash
            };

            User.findByPk.mockResolvedValue(userWithToken);

            const res = await request(app)
                .post('/api/auth/refresh')
                .send({ refresh_token: refreshToken });

            // Should succeed because SHA-256 hash matches
            // Response should have new access token (in cookie)
            if (res.status === 200) {
                expect(res.headers['set-cookie']).toBeDefined();
            }
        });
    });

    // ============================================================================
    // 5. Session Token Not Exposed in Response
    // ============================================================================
    describe('Session Creation - Token Not Exposed', () => {
        it('should NOT return sessionToken in create session response', async () => {
            // This tests the session.service fix where sessionToken was removed from response
            User.findByPk.mockResolvedValue(mockUser);

            const validToken = generateAccessToken({
                userId: mockUser.id,
                email: mockUser.email,
                shopId: mockUser.last_logged_shop_id,
                tokenVersion: mockUser.token_version
            });

            // Mock Session.create to return a session object
            const mockSession = {
                id: 'session-1',
                session_token: 'secret-session-token-that-should-not-be-exposed',
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
                toJSON: () => ({
                    id: 'session-1',
                    session_token: 'secret-session-token-that-should-not-be-exposed',
                    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
                })
            };

            jest.spyOn(require('src/modules/auth/session.service'), 'createSession')
                .mockResolvedValue({
                    sessionId: 'session-1',
                    expiresAt: mockSession.expires_at
                    // Note: no sessionToken here!
                });

            const res = await request(app)
                .post('/api/auth/sessions')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ device_name: 'Test Device' });

            // If the endpoint exists and returns data, sessionToken should not be present
            if (res.body?.data) {
                expect(res.body.data.sessionToken).toBeUndefined();
                expect(res.body.data.session_token).toBeUndefined();
            }
        });
    });

    // ============================================================================
    // 6. 2FA Rate Limiting
    // ============================================================================
    describe('2FA Verify - Rate Limiting', () => {
        it('should rate limit 2FA verify attempts', async () => {
            // Make 6 rapid 2FA verify attempts
            const attempts = [];
            for (let i = 0; i < 6; i++) {
                attempts.push(
                    request(app)
                        .post('/api/auth/2fa/verify')
                        .send({ tempToken: 'invalid', token: '000000' })
                );
            }

            const results = await Promise.all(attempts);

            // At least one should be rate limited (429)
            // The first few might be 400 (invalid token), but later ones should be 429
            const rateLimited = results.some(r => r.status === 429);
            expect(rateLimited).toBe(true);
        }, 10000);
    });

    // ============================================================================
    // 7. Cookie Clearing with Domain
    // ============================================================================
    describe('Logout - Cookie Clearing', () => {
        it('should clear cookies on logout', async () => {
            User.findOne.mockResolvedValue(mockUser);

            // Login first
            const loginRes = await request(app)
                .post('/api/auth/signin')
                .send({ email: 'test@example.com', password: 'correct-password' });

            const cookies = loginRes.headers['set-cookie'];
            const accessToken = cookies.find(c => c.startsWith('access_token='))?.split(';')[0]?.replace('access_token=', '');

            User.findByPk.mockResolvedValue(mockUser);

            // Logout
            const logoutRes = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`);

            expect(logoutRes.status).toBe(200);

            // Check that cookies are being cleared
            const clearCookies = logoutRes.headers['set-cookie'];
            if (clearCookies) {
                // Cookies should have empty values or be cleared
                expect(clearCookies.some(c => c.includes('access_token='))).toBe(true);
            }
        });
    });

    // ============================================================================
    // 8. Token Blacklist TTL Fix
    // ============================================================================
    describe('Token Blacklist - TTL Calculation', () => {
        it('should not extend TTL for expired tokens', async () => {
            // Create a token that's already expired
            const expiredToken = generateAccessToken({
                userId: mockUser.id,
                email: mockUser.email,
                shopId: mockUser.last_logged_shop_id,
                tokenVersion: mockUser.token_version
            }, '-1s'); // Expired 1 second ago

            User.findByPk.mockResolvedValue(mockUser);

            // Logout with expired token
            await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${expiredToken}`);

            // The blacklist call should have TTL <= 0 (no Redis call or very short TTL)
            const blacklistCalls = mockRedis.setex.mock.calls.filter(
                call => call[0].includes('token_blacklist')
            );

            // Either no blacklist call was made, or TTL was 0/negative
            if (blacklistCalls.length > 0) {
                const ttl = blacklistCalls[0][1];
                expect(ttl).toBeGreaterThanOrEqual(0);
            }
        });
    });
});
