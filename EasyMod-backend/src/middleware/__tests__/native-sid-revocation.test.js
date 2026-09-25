'use strict';

/**
 * ADR M-004: authenticate() gains exactly one additive branch — a `sid`
 * revocation lookup, consulted only when the decoded token carries a `sid`
 * claim. Every existing (web) token has no such claim and must skip this
 * branch entirely; this file proves that byte-for-byte with mocks, as a fast
 * companion to the full auth.security.test.js / auth-token-version.security
 * suites (which continue to pass unchanged — see PR description for counts).
 */

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret-key-32-chars!!';

jest.mock('src/utils/cache.service', () => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => true),
}));

const mockUser = { id: 'user-1', token_version: 1 };
const mockUserShopFindOne = jest.fn();
jest.mock('src/modules/entities', () => ({
    User: { findByPk: jest.fn(async () => mockUser) },
    UserShop: { findOne: (...args) => mockUserShopFindOne(...args) },
}));

jest.mock('src/modules/auth/auth.service', () => ({
    isTokenBlacklisted: jest.fn(async () => false),
}));

const mockSessionFindByPk = jest.fn();
jest.mock('src/modules/auth/session.entity', () => ({
    findByPk: (...args) => mockSessionFindByPk(...args),
}));

const jwt = require('jsonwebtoken');
const config = require('src/config/config');
const { authenticate, authenticateForPasswordChange } = require('src/middleware/auth.middleware');

const sign = (payload) =>
    jwt.sign(payload, config.jwtAccessSecret, { algorithm: 'HS256', expiresIn: '15m' });

const runMiddleware = (token, overrides = {}, middleware = authenticate) =>
    new Promise((resolve) => {
        const req = {
            headers: { authorization: `Bearer ${token}` },
            cookies: {},
            method: 'GET',
            path: '/api/auth/me',
            ...overrides,
        };
        const res = {};
        const next = (err) => resolve({ req, err });
        middleware(req, res, next);
    });

describe('auth.middleware sid revocation branch (ADR M-004)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSessionFindByPk.mockResolvedValue({
            id: 'sid-1',
            user_id: 'user-1',
            shop_id: 'shop-1',
            is_active: true,
            expires_at: new Date(Date.now() + 60_000),
        });
        mockUserShopFindOne.mockResolvedValue({ id: 'membership-1' });
    });

    test('REGRESSION: a token with no sid claim (every existing web token) never queries the sessions table and authenticates exactly as before', async () => {
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1 });
        const { req, err } = await runMiddleware(token);

        expect(mockSessionFindByPk).not.toHaveBeenCalled();
        expect(err).toBeUndefined();
        expect(req.user).toEqual({
            userId: 'user-1',
            email: 'a@b.com',
            shopId: 'shop-1',
            exp: expect.any(Number),
            mfaVerified: false,
            passwordChangeRequired: false,
            temporaryPasswordExpiresAt: null,
            sid: undefined,
        });
    });

    test('a token with a sid claim for an active session authenticates and attaches sid to req.user', async () => {
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1' });
        const { req, err } = await runMiddleware(token, { path: '/api/mobile/attention' });

        expect(mockSessionFindByPk).toHaveBeenCalledWith('sid-1', expect.any(Object));
        expect(err).toBeUndefined();
        expect(req.user.sid).toBe('sid-1');
    });

    test('a token with a sid claim for a revoked (is_active: false) session is rejected with 401', async () => {
        mockSessionFindByPk.mockResolvedValue({ id: 'sid-1', is_active: false });
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1' });
        const { err } = await runMiddleware(token);

        expect(err).toBeDefined();
        expect(err.status).toBe(401);
    });

    test('a token with a sid claim for an expired session is rejected with 401', async () => {
        mockSessionFindByPk.mockResolvedValue({
            id: 'sid-1',
            is_active: true,
            expires_at: new Date(Date.now() - 1),
        });
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1' });
        const { err } = await runMiddleware(token);

        expect(err).toBeDefined();
        expect(err.status).toBe(401);
    });

    test('a native sid token cannot invoke an existing web mutation route', async () => {
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1' });
        const { req, err } = await runMiddleware(token, {
            method: 'POST',
            path: '/api/conversation/conversation-1/messages',
        });

        expect(err).toBeDefined();
        expect(err.status).toBe(403);
        expect(err.code).toBe('NATIVE_READ_ONLY');
        expect(req.user).toBeUndefined();
    });

    test('a sid-less web token still authenticates for an existing mutation route', async () => {
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1 });
        const { req, err } = await runMiddleware(token, {
            method: 'POST',
            path: '/api/conversation/conversation-1/messages',
        });

        expect(err).toBeUndefined();
        expect(req.user.sid).toBeUndefined();
        expect(mockSessionFindByPk).not.toHaveBeenCalled();
    });

    test('a token with a sid claim for a session that no longer exists is rejected with 401', async () => {
        mockSessionFindByPk.mockResolvedValue(null);
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-missing' });
        const { err } = await runMiddleware(token);

        expect(err).toBeDefined();
        expect(err.status).toBe(401);
    });

    describe('native read allowlist (audit P1-9)', () => {
        const nativeToken = () => sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1' });
        const ENTITY_ID = '0b9f2c1e-5d4a-4c3b-9a8f-7e6d5c4b3a21';

        test.each([
            ['/api/mobile/today'],
            ['/api/mobile/attention?limit=20'],
            [`/api/order/${ENTITY_ID}`],
            [`/api/conversation/${ENTITY_ID}`],
        ])('allows a native GET of the mobile read surface %s', async (originalUrl) => {
            const { req, err } = await runMiddleware(nativeToken(), { originalUrl });

            expect(err).toBeUndefined();
            expect(req.user.sid).toBe('sid-1');
        });

        test.each([
            ['/api/auth/me'],
            ['/api/order'],
            ['/api/order/not-a-uuid'],
            [`/api/order/${ENTITY_ID}/timeline`],
            ['/api/analytics/funnel'],
            ['/api/customer/export'],
            ['/api/shop/settings'],
        ])('refuses a native GET outside the mobile read surface: %s', async (originalUrl) => {
            const { req, err } = await runMiddleware(nativeToken(), { originalUrl });

            expect(err).toBeDefined();
            expect(err.status).toBe(403);
            expect(err.code).toBe('NATIVE_ROUTE_NOT_ALLOWED');
            expect(req.user).toBeUndefined();
        });

        test('still allows native auth/session routes with any method', async () => {
            const { err } = await runMiddleware(nativeToken(), {
                method: 'POST',
                originalUrl: '/api/auth/native/switch-shop',
            });

            expect(err).toBeUndefined();
        });

        test('does not apply the allowlist or the session lookup to sid-less web tokens', async () => {
            const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1 });
            const { err } = await runMiddleware(token, { originalUrl: '/api/analytics/funnel' });

            expect(err).toBeUndefined();
            expect(mockSessionFindByPk).not.toHaveBeenCalled();
            // main's web membership re-check, not the native one.
            expect(mockUserShopFindOne).toHaveBeenCalledTimes(1);
        });
    });

    describe('native session binding and live membership (audit P1-9 / P0-2)', () => {
        const nativeToken = () =>
            sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1' });
        const activeSession = (overrides) => ({
            id: 'sid-1',
            user_id: 'user-1',
            shop_id: 'shop-1',
            is_active: true,
            expires_at: new Date(Date.now() + 60_000),
            ...overrides,
        });

        test('rejects an access token whose shop no longer matches its session (superseded by switch-shop)', async () => {
            mockSessionFindByPk.mockResolvedValue(activeSession({ shop_id: 'shop-2' }));
            const { req, err } = await runMiddleware(nativeToken(), { originalUrl: '/api/mobile/today' });

            expect(err.status).toBe(401);
            expect(req.user).toBeUndefined();
        });

        test('rejects a sid that belongs to a different user', async () => {
            mockSessionFindByPk.mockResolvedValue(activeSession({ user_id: 'user-2' }));
            const { err } = await runMiddleware(nativeToken(), { originalUrl: '/api/mobile/today' });

            expect(err.status).toBe(401);
        });

        test('rejects a native token as soon as its shop membership is deactivated', async () => {
            mockUserShopFindOne.mockResolvedValue(null);
            const { req, err } = await runMiddleware(nativeToken(), { originalUrl: '/api/mobile/today' });

            expect(mockUserShopFindOne).toHaveBeenCalledWith(expect.objectContaining({
                where: { user_id: 'user-1', shop_id: 'shop-1', is_active: true },
            }));
            expect(err.status).toBe(401);
            expect(err.code).toBe('NATIVE_SHOP_ACCESS_REVOKED');
            expect(req.user).toBeUndefined();
        });
    });

    // feature/mobile-app -> main: both sides changed this middleware. main
    // re-checks web shop membership (403) and gates temporary-password
    // sessions; the mobile branch adds the native session, read-only allowlist
    // and membership checks (401). Every check survives the merge.
    describe('main + mobile merge resolution', () => {
        const nativeToken = (extra = {}) =>
            sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1', ...extra });
        const webToken = (extra = {}) =>
            sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, ...extra });

        test('a native token checks shop membership exactly once', async () => {
            const { err } = await runMiddleware(nativeToken(), { originalUrl: '/api/mobile/today' });

            expect(err).toBeUndefined();
            expect(mockUserShopFindOne).toHaveBeenCalledTimes(1);
        });

        test('a native token that lost its membership gets the native 401, not the web 403', async () => {
            mockUserShopFindOne.mockResolvedValue(null);
            const { err } = await runMiddleware(nativeToken(), { originalUrl: '/api/mobile/today' });

            expect(err.status).toBe(401);
            expect(err.code).toBe('NATIVE_SHOP_ACCESS_REVOKED');
            expect(mockUserShopFindOne).toHaveBeenCalledTimes(1);
        });

        test('a web token that lost its membership keeps the web 403 and never touches the sessions table', async () => {
            mockUserShopFindOne.mockResolvedValue(null);
            const { req, err } = await runMiddleware(webToken(), { originalUrl: '/api/analytics/funnel' });

            expect(err.status).toBe(403);
            expect(err.code).toBe('GROWTH_OS_FORBIDDEN');
            expect(req.user).toBeUndefined();
            expect(mockSessionFindByPk).not.toHaveBeenCalled();
        });

        test('a web temporary-password session is still confined to the password-change route', async () => {
            const token = webToken({
                passwordChangeRequired: true,
                temporaryPasswordExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            });

            const blocked = await runMiddleware(token, { originalUrl: '/api/analytics/funnel' });
            expect(blocked.err.status).toBe(403);
            expect(blocked.err.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');

            const allowed = await runMiddleware(
                token,
                { method: 'POST', originalUrl: '/api/auth/change-password' },
                authenticateForPasswordChange,
            );
            expect(allowed.err).toBeUndefined();
            expect(allowed.req.user.passwordChangeRequired).toBe(true);
        });

        test('a native token cannot use the web password-change route', async () => {
            const { req, err } = await runMiddleware(
                nativeToken(),
                { method: 'POST', originalUrl: '/api/auth/change-password' },
                authenticateForPasswordChange,
            );

            expect(err.status).toBe(403);
            expect(err.code).toBe('NATIVE_READ_ONLY');
            expect(req.user).toBeUndefined();
        });
    });
});
