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
jest.mock('src/modules/entities', () => ({
    User: { findByPk: jest.fn(async () => mockUser) },
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
const { authenticate } = require('src/middleware/auth.middleware');

const sign = (payload) =>
    jwt.sign(payload, config.jwtAccessSecret, { algorithm: 'HS256', expiresIn: '15m' });

const runMiddleware = (token, overrides = {}) =>
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
        authenticate(req, res, next);
    });

describe('auth.middleware sid revocation branch (ADR M-004)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSessionFindByPk.mockResolvedValue({
            id: 'sid-1',
            is_active: true,
            expires_at: new Date(Date.now() + 60_000),
        });
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
            sid: undefined,
        });
    });

    test('a token with a sid claim for an active session authenticates and attaches sid to req.user', async () => {
        const token = sign({ userId: 'user-1', email: 'a@b.com', shopId: 'shop-1', tokenVersion: 1, sid: 'sid-1' });
        const { req, err } = await runMiddleware(token);

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
});
