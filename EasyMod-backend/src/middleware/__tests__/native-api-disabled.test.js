'use strict';

/**
 * ADR M-010 rollback: turning MOBILE_API_ENABLED off must stop every native
 * token already issued, not only new sign-ins. The flag-gated routers already
 * 404 /api/auth/native/* and /api/mobile/*; the order/conversation detail
 * reads a native token may use live outside them, so authenticate() itself
 * refuses a sid token while the flag is off. Web (sid-less) tokens are
 * unaffected.
 *
 * Deliberately its own file: config.js reads process.env.MOBILE_API_ENABLED
 * once at load, so the flag-on companion (native-sid-revocation.test.js)
 * cannot share this module registry. This file must NEVER set the flag.
 */

delete process.env.MOBILE_API_ENABLED;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret-key-32-chars!!';

jest.mock('src/utils/cache.service', () => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => true),
}));

const mockUserShopFindOne = jest.fn(async () => ({ id: 'membership-1' }));
jest.mock('src/modules/entities', () => ({
    User: { findByPk: jest.fn(async () => ({ id: 'user-1', token_version: 1 })) },
    UserShop: { findOne: (...args) => mockUserShopFindOne(...args) },
}));

jest.mock('src/modules/auth/auth.service', () => ({
    isTokenBlacklisted: jest.fn(async () => false),
}));

const mockSessionFindByPk = jest.fn(async () => ({
    id: 'sid-1',
    user_id: 'user-1',
    shop_id: 'shop-1',
    is_active: true,
    expires_at: new Date(Date.now() + 60_000),
}));
jest.mock('src/modules/auth/session.entity', () => ({
    findByPk: (...args) => mockSessionFindByPk(...args),
}));

const jwt = require('jsonwebtoken');
const config = require('src/config/config');
const { authenticate } = require('src/middleware/auth.middleware');

const sign = (payload) =>
    jwt.sign(payload, config.jwtAccessSecret, { algorithm: 'HS256', expiresIn: '15m' });

const run = (token, originalUrl, method = 'GET') =>
    new Promise((resolve) => {
        const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, method, originalUrl };
        authenticate(req, {}, (err) => resolve({ req, err }));
    });

const ORDER_ID = '11111111-2222-4333-8444-555555555555';

describe('native tokens while MOBILE_API_ENABLED is off (ADR M-010 rollback)', () => {
    beforeEach(() => jest.clearAllMocks());

    test('the flag really is off in this module registry', () => {
        expect(config.mobileApiEnabled).toBe(false);
    });

    test.each([
        `/api/order/${ORDER_ID}`,
        `/api/conversation/${ORDER_ID}`,
        '/api/mobile/attention',
        '/api/auth/native/sessions',
    ])('refuses an otherwise-valid native token on %s before any session lookup', async (originalUrl) => {
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1' });
        const { req, err } = await run(token, originalUrl);

        expect(err).toMatchObject({ status: 401, code: 'NATIVE_API_DISABLED' });
        expect(req.user).toBeUndefined();
        expect(mockSessionFindByPk).not.toHaveBeenCalled();
    });

    test('a web (sid-less) token is unaffected and keeps its full method surface', async () => {
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1 });
        const { req, err } = await run(token, `/api/order/${ORDER_ID}`, 'PATCH');

        expect(err).toBeUndefined();
        expect(req.user).toMatchObject({ userId: 'user-1', shopId: 'shop-1' });
        expect(req.user.sid).toBeUndefined();
        expect(mockSessionFindByPk).not.toHaveBeenCalled();
    });
});
