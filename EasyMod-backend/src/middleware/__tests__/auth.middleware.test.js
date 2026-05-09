'use strict';

/**
 * Tests for src/middleware/auth.middleware.js
 *
 * Covers:
 *   authenticate          — 9 cases
 *   checkSubscriptionStatus — 6 cases
 */

// ─── Environment ────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-secret';

// ─── Mocks (paths must match require() calls inside auth.middleware.js) ──────

// auth.middleware.js: require('../utils/jwt.util')
jest.mock('../utils/jwt.util', () => ({
  verifyAccessToken: jest.fn(),
}));

// auth.middleware.js: require('../modules/auth/auth.service')
jest.mock('../modules/auth/auth.service', () => ({
  isTokenBlacklisted: jest.fn(),
}));

// auth.middleware.js: require('../modules/entities')   (top-level + lazy-require)
jest.mock('../modules/entities', () => ({
  User: { findByPk: jest.fn() },
  Subscription: { findOne: jest.fn() },
}));

// auth.middleware.js: require('../utils/cache.service')
jest.mock('../utils/cache.service', () => ({
  getForShop: jest.fn(),
  setForShop: jest.fn(),
}));

// AppError is NOT mocked — we test real instances so instanceof checks work.

// ─── Imports (after mocks are declared) ─────────────────────────────────────
const { authenticate, checkSubscriptionStatus } = require('../auth.middleware');
const { AppError } = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/jwt.util');
const { isTokenBlacklisted } = require('../modules/auth/auth.service');
const { User, Subscription } = require('../modules/entities');
const cacheService = require('../utils/cache.service');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal mock request object. */
const mockReq = (overrides = {}) => ({
  headers: {},
  cookies: {},
  user: null,
  ...overrides,
});

/** Build a mock response whose chainable methods return itself. */
const mockRes = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

/** A freshly-cleared next mock (returned for convenience). */
const makeMockNext = () => jest.fn();

// ─── Shared decoded payload ───────────────────────────────────────────────────
const BASE_DECODED = {
  userId: 'user-123',
  email: 'test@example.com',
  shopId: 'shop-456',
  exp: Math.floor(Date.now() / 1000) + 3600,
};

// ─────────────────────────────────────────────────────────────────────────────
// authenticate
// ─────────────────────────────────────────────────────────────────────────────
describe('authenticate middleware', () => {
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    res = mockRes();
    next = makeMockNext();

    // Sane defaults — each test overrides as needed
    verifyAccessToken.mockReturnValue(BASE_DECODED);
    isTokenBlacklisted.mockResolvedValue(false);
    User.findByPk.mockResolvedValue({ token_version: 1 });
  });

  // ── 1. No token provided ────────────────────────────────────────────────────
  it('calls next with a 401 AppError when no token is present', async () => {
    const req = mockReq(); // no Authorization header, no cookies

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/no token/i);
  });

  // ── 2. Valid Bearer token ───────────────────────────────────────────────────
  it('attaches req.user and calls next() for a valid Bearer token', async () => {
    const decoded = { ...BASE_DECODED }; // no tokenVersion → skip version check
    verifyAccessToken.mockReturnValue(decoded);

    const req = mockReq({
      headers: { authorization: 'Bearer valid.jwt.token' },
    });

    await authenticate(req, res, next);

    expect(verifyAccessToken).toHaveBeenCalledWith('valid.jwt.token');
    expect(isTokenBlacklisted).toHaveBeenCalledWith('valid.jwt.token');
    expect(req.user).toEqual({
      userId: decoded.userId,
      email: decoded.email,
      shopId: decoded.shopId,
      exp: decoded.exp,
    });
    expect(next).toHaveBeenCalledWith(/* no arguments */);
    expect(next.mock.calls[0]).toHaveLength(0);
  });

  // ── 3. Valid cookie token ───────────────────────────────────────────────────
  it('reads the token from the access_token cookie when no header is present', async () => {
    const decoded = { ...BASE_DECODED };
    verifyAccessToken.mockReturnValue(decoded);

    const req = mockReq({
      cookies: { access_token: 'cookie.jwt.token' },
    });

    await authenticate(req, res, next);

    expect(verifyAccessToken).toHaveBeenCalledWith('cookie.jwt.token');
    expect(req.user).not.toBeNull();
    expect(next).toHaveBeenCalledWith();
  });

  // ── 4. Blacklisted token ───────────────────────────────────────────────────
  it('calls next with a 401 AppError for a blacklisted token', async () => {
    isTokenBlacklisted.mockResolvedValue(true);

    const req = mockReq({
      headers: { authorization: 'Bearer revoked.token' },
    });

    await authenticate(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/revoked/i);
  });

  // ── 5. verifyAccessToken throws ────────────────────────────────────────────
  it('calls next with a 401 AppError when verifyAccessToken throws', async () => {
    verifyAccessToken.mockImplementation(() => {
      throw new Error('jwt malformed');
    });

    const req = mockReq({
      headers: { authorization: 'Bearer bad.token' },
    });

    await authenticate(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
    // The catch block wraps non-AppErrors with a generic message
    expect(err.message).toMatch(/invalid or expired/i);
  });

  // ── 6. Token without tokenVersion — skips version check ───────────────────
  it('skips the token-version DB check when decoded.tokenVersion is absent', async () => {
    const decoded = { ...BASE_DECODED }; // tokenVersion not set
    delete decoded.tokenVersion;
    verifyAccessToken.mockReturnValue(decoded);

    const req = mockReq({
      headers: { authorization: 'Bearer no.version.token' },
    });

    await authenticate(req, res, next);

    expect(User.findByPk).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  // ── 7. Token version matches — passes ─────────────────────────────────────
  it('passes when decoded.tokenVersion matches the stored user token_version', async () => {
    const decoded = { ...BASE_DECODED, tokenVersion: 3 };
    verifyAccessToken.mockReturnValue(decoded);
    User.findByPk.mockResolvedValue({ token_version: 3 });

    const req = mockReq({
      headers: { authorization: 'Bearer versioned.token' },
    });

    await authenticate(req, res, next);

    expect(User.findByPk).toHaveBeenCalledWith(decoded.userId, {
      attributes: ['token_version'],
    });
    expect(next).toHaveBeenCalledWith();
  });

  // ── 8. Token version mismatch ──────────────────────────────────────────────
  it('calls next with a 401 AppError when tokenVersion does not match', async () => {
    const decoded = { ...BASE_DECODED, tokenVersion: 2 };
    verifyAccessToken.mockReturnValue(decoded);
    User.findByPk.mockResolvedValue({ token_version: 99 }); // mismatch

    const req = mockReq({
      headers: { authorization: 'Bearer stale.token' },
    });

    await authenticate(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/invalidated/i);
  });

  // ── 9. User not found during token-version check ───────────────────────────
  it('calls next with a 401 AppError when the user record is not found', async () => {
    const decoded = { ...BASE_DECODED, tokenVersion: 1 };
    verifyAccessToken.mockReturnValue(decoded);
    User.findByPk.mockResolvedValue(null); // user deleted

    const req = mockReq({
      headers: { authorization: 'Bearer orphan.token' },
    });

    await authenticate(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkSubscriptionStatus
// ─────────────────────────────────────────────────────────────────────────────
describe('checkSubscriptionStatus middleware', () => {
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    res = mockRes();
    next = makeMockNext();

    // Default: cache miss, active subscription in DB
    cacheService.getForShop.mockResolvedValue(null);
    cacheService.setForShop.mockResolvedValue(undefined);
    Subscription.findOne.mockResolvedValue({ status: 'active' });
  });

  // ── 1. No shopId on req.user — pass through ────────────────────────────────
  it('calls next() immediately when req.user has no shopId', async () => {
    const req = mockReq({ user: { userId: 'user-123', email: 'a@b.com' } }); // no shopId

    await checkSubscriptionStatus(req, res, next);

    expect(cacheService.getForShop).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  // ── 2. Active status returned from cache ───────────────────────────────────
  it('calls next() when cache returns "active"', async () => {
    cacheService.getForShop.mockResolvedValue('active');

    const req = mockReq({ user: { shopId: 'shop-1' } });

    await checkSubscriptionStatus(req, res, next);

    expect(Subscription.findOne).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  // ── 3. Suspended status — 402 ─────────────────────────────────────────────
  it('calls next with a 402 AppError when subscription status is "suspended"', async () => {
    cacheService.getForShop.mockResolvedValue('suspended');

    const req = mockReq({ user: { shopId: 'shop-suspended' } });

    await checkSubscriptionStatus(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(402);
    expect(err.message).toMatch(/suspended/i);
  });

  // ── 4. Cache miss → fetches from DB, caches result, calls next() ──────────
  it('fetches from DB on cache miss, writes to cache, and calls next()', async () => {
    cacheService.getForShop.mockResolvedValue(null); // cache miss
    Subscription.findOne.mockResolvedValue({ status: 'active' });

    const req = mockReq({ user: { shopId: 'shop-db' } });

    await checkSubscriptionStatus(req, res, next);

    expect(Subscription.findOne).toHaveBeenCalledWith({
      where: { shop_id: 'shop-db' },
      attributes: ['status'],
    });
    expect(cacheService.setForShop).toHaveBeenCalledWith(
      'shop-db',
      'subscription:status',
      'active',
      60
    );
    expect(next).toHaveBeenCalledWith();
  });

  // ── 5. DB error — fail closed with 503 ────────────────────────────────────
  it('calls next with a 503 AppError when the DB lookup throws', async () => {
    cacheService.getForShop.mockResolvedValue(null);
    Subscription.findOne.mockRejectedValue(new Error('DB connection lost'));

    const req = mockReq({ user: { shopId: 'shop-err' } });

    await checkSubscriptionStatus(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/temporarily unavailable/i);
  });

  // ── 6. No subscription row in DB — defaults to "active" ───────────────────
  it('defaults to "active" and calls next() when no subscription row exists', async () => {
    cacheService.getForShop.mockResolvedValue(null);
    Subscription.findOne.mockResolvedValue(null); // no row

    const req = mockReq({ user: { shopId: 'shop-new' } });

    await checkSubscriptionStatus(req, res, next);

    // Should cache 'active' and pass through
    expect(cacheService.setForShop).toHaveBeenCalledWith(
      'shop-new',
      'subscription:status',
      'active',
      60
    );
    expect(next).toHaveBeenCalledWith();
  });

  // ── Bonus: suspended status from DB (not just cache) ─────────────────────
  it('blocks with 402 when the DB returns status "suspended" (cache was empty)', async () => {
    cacheService.getForShop.mockResolvedValue(null);
    Subscription.findOne.mockResolvedValue({ status: 'suspended' });

    const req = mockReq({ user: { shopId: 'shop-bad-payer' } });

    await checkSubscriptionStatus(req, res, next);

    // Should have cached the value before blocking
    expect(cacheService.setForShop).toHaveBeenCalledWith(
      'shop-bad-payer',
      'subscription:status',
      'suspended',
      60
    );

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(402);
  });

  // ── Bonus: cacheService.getForShop itself throws ──────────────────────────
  it('calls next with a 503 AppError when getForShop throws', async () => {
    cacheService.getForShop.mockRejectedValue(new Error('Redis down'));

    const req = mockReq({ user: { shopId: 'shop-redis-gone' } });

    await checkSubscriptionStatus(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(503);
  });
});
