'use strict';

/**
 * ADR M-004 — native auth routes. Mounted at /api/auth/native (see
 * auth.routes.js) — a clean, dedicated path, NOT a reuse of the existing
 * double-mounted /api/auth/sessions/sessions bug, which is left untouched.
 *
 * Every route here is gated by MOBILE_API_ENABLED: 404 (not 401/403) when
 * off, per ADR M-010 — indistinguishable from a route that doesn't exist.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { MemoryStore } = rateLimit;
const config = require('../../../config/config');
const { AppError } = require('../../../utils/AppError');
const validate = require('../../../middleware/validate.middleware');
const { authenticate } = require('../../../middleware/auth.middleware');
const nativeAuthController = require('./native-auth.controller');
const nativeSessionController = require('./native-session.controller');
const {
    nativeSigninValidator,
    native2faVerifyValidator,
    nativeRefreshValidator,
    switchShopValidator,
} = require('./native.validator');

const router = express.Router();

function buildNativeTwoFactorRateLimitStore() {
    if (config.env === 'test') return new MemoryStore();

    try {
        const { rateLimitRedis } = require('../../../config/redis');
        if (rateLimitRedis && typeof rateLimitRedis.call === 'function') {
            return new RedisStore({
                prefix: 'rl:native-2fa:',
                sendCommand: (...args) => rateLimitRedis.call(...args),
            });
        }
    } catch (_error) {
        // Express's process-local MemoryStore remains the safe fallback.
    }

    return new MemoryStore();
}

// The native mount is outside the web 2FA route, so it needs its own brute-force
// boundary: five attempts per five-minute window per source IP; the sixth gets 429.
// Keep the contract identical to web 2FA and enforce it in production with the
// shared Redis store when available.
const nativeTwoFactorRateLimitStore = buildNativeTwoFactorRateLimitStore();
const nativeTwoFactorRateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    message: {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many 2FA attempts. Please try again later.' },
    },
    store: nativeTwoFactorRateLimitStore,
});

router.use((req, res, next) => {
    if (!config.mobileApiEnabled) {
        return next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
    }
    next();
});

router.post('/signin', validate(nativeSigninValidator), nativeAuthController.signin);
router.post(
    '/2fa/verify',
    nativeTwoFactorRateLimiter,
    validate(native2faVerifyValidator),
    nativeAuthController.verifyTwoFactor,
);
router.post('/refresh', validate(nativeRefreshValidator), nativeAuthController.refresh);
// Access authentication is optional here so a valid refresh_token can revoke
// the native session after the short-lived access token has expired. When an
// access token is present, authenticate still validates it normally; a 401 is
// bypassed only when the refresh-token proof is supplied and revalidated below.
router.post('/logout', (req, res, next) => {
    if (!req.headers.authorization && !req.cookies?.access_token) return next();

    authenticate(req, res, (error) => {
        if (!error) return next();
        if (error.status === 401 && req.body?.refresh_token) return next();
        return next(error);
    });
}, nativeAuthController.logout);
router.post('/switch-shop', authenticate, validate(switchShopValidator), nativeAuthController.switchShop);

// Own device sessions — see native-session.controller.js.
router.get('/sessions', authenticate, nativeSessionController.list);
router.delete('/sessions/:id', authenticate, nativeSessionController.revoke);

/**
 * Used only by the disposable mobile E2E fixture reset (mobile-e2e-fixtures.js),
 * which is itself unreachable outside NODE_ENV=test. The test-env store is the
 * process-local MemoryStore; this is a no-op for any store without resetAll.
 */
router.__resetTwoFactorAttemptsForE2E = () => {
    if (config.env !== 'test') return;
    if (typeof nativeTwoFactorRateLimitStore.resetAll === 'function') {
        void nativeTwoFactorRateLimitStore.resetAll();
    }
};

module.exports = router;
