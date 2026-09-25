const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const config = require('../../config/config');
const authController = require('./auth.controller');
const sessionController = require('./session.controller');
const totpController = require('./totp.controller');
const { signupValidator, signinValidator, refreshTokenValidator, forgotPasswordValidator, resetPasswordValidator, changePasswordValidator } = require('./auth.validator');
const { authenticate, authenticateForPasswordChange } = require('../../middleware/auth.middleware');
const validate = require('../../middleware/validate.middleware');
const { AppError } = require('../../utils/AppError');

const router = express.Router();

// Rate limiters for password reset (prevent email enumeration / spam)
let forgotPasswordIpLimiter;
let forgotPasswordEmailLimiter;
if (config.env !== 'test') {
    try {
        const { rateLimitRedis } = require('../../config/redis');
        const makeStore = (prefix) => rateLimitRedis && typeof rateLimitRedis.call === 'function'
            ? new RedisStore({ prefix, sendCommand: (...args) => rateLimitRedis.call(...args) })
            : undefined;

        forgotPasswordIpLimiter = rateLimit({
            windowMs: 60 * 60 * 1000, // 1 hour
            max: 3,
            message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many password reset requests. Try again in 1 hour.' } },
            standardHeaders: true,
            legacyHeaders: false,
            store: makeStore('rl:fp-ip:'),
            keyGenerator: (req) => req.ip,
        });

        forgotPasswordEmailLimiter = rateLimit({
            windowMs: 60 * 60 * 1000, // 1 hour
            max: 1,
            message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many password reset requests for this email. Try again in 1 hour.' } },
            standardHeaders: true,
            legacyHeaders: false,
            store: makeStore('rl:fp-email:'),
            keyGenerator: (req) => (req.body?.email || req.ip).toLowerCase(),
        });
    } catch (error) {
        console.error('Failed to initialize forgot-password rate limiters:', error);
    }
}

const fpIpLimiter    = forgotPasswordIpLimiter    || ((req, res, next) => next());
const fpEmailLimiter = forgotPasswordEmailLimiter || ((req, res, next) => next());

// Specific rate limiter for refresh endpoint (stricter than general auth)
let refreshRateLimiter;
if (config.env !== 'test') {
    try {
        const { rateLimitRedis } = require('../../config/redis');
        const store = rateLimitRedis && typeof rateLimitRedis.call === 'function'
            ? new RedisStore({
                prefix: 'rl:refresh:',
                sendCommand: (...args) => rateLimitRedis.call(...args)
            })
            : undefined;
            
        refreshRateLimiter = rateLimit({
            windowMs: 5 * 60 * 1000, // 5 minutes
            max: 20, // 20 refresh attempts per 5 minutes per IP
            message: { 
                success: false, 
                error: { 
                    code: 'RATE_LIMIT_EXCEEDED', 
                    message: 'Too many refresh attempts. Please try again later.' 
                } 
            },
            standardHeaders: true,
            legacyHeaders: false,
            store,
            keyGenerator: (req) => req.ip
        });
    } catch (error) {
        console.error('Failed to initialize refresh rate limiter:', error);
        // Continue without rate limiting if Redis fails
    }
}

// POST /auth/signup - User registration
router.post('/signup', validate(signupValidator), authController.signup);

// POST /auth/signin - User login
router.post('/signin', validate(signinValidator), authController.signin);

// POST /auth/refresh - Refresh access token with stricter rate limiting
router.post('/refresh', 
    refreshRateLimiter ? refreshRateLimiter : (req, res, next) => next(), 
    validate(refreshTokenValidator), 
    authController.refresh
);

// GET /auth/me - Get current auth context
router.get('/me', authenticate, authController.me);

// POST /auth/forgot-password - Request password reset email (rate limited per IP + per email)
router.post('/forgot-password',
    fpIpLimiter,
    fpEmailLimiter,
    validate(forgotPasswordValidator),
    authController.forgotPassword
);

// POST /auth/reset-password - Reset password with token
router.post('/reset-password', validate(resetPasswordValidator), authController.resetPassword);

// POST /auth/change-password - Complete a temporary-password login
router.post('/change-password', validate(changePasswordValidator), authenticateForPasswordChange, authController.changeTemporaryPassword);

// POST /auth/logout - Logout and revoke token
router.post('/logout', authenticate, authController.logout);

// 2FA / TOTP routes
// POST /auth/2fa/setup   — generate secret (requires auth)
router.post('/2fa/setup', authenticate, totpController.setup);
// POST /auth/2fa/enable  — activate with first token (requires auth)
router.post('/2fa/enable', authenticate, totpController.enable);
// POST /auth/2fa/verify  — step-2 login (no auth header — uses tempToken in body)
// Rate limited to prevent brute force (1M possible 6-digit codes)
const TOTP_VERIFY_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const TOTP_VERIFY_RATE_LIMIT_PREFIX = 'rl:totp-verify:';
const TOTP_VERIFY_RATE_LIMIT_UNAVAILABLE = 'Two-factor rate limiting is temporarily unavailable. Please try again later.';

const totpVerifyKeyGenerator = (req) => {
    const rawChallengeIdentifier = req.body?.tempToken;
    const challengeIdentifier = typeof rawChallengeIdentifier === 'string' && rawChallengeIdentifier.length > 0
        ? rawChallengeIdentifier
        : 'missing';
    // Keep the opaque challenge out of the Redis key value and any incidental
    // diagnostics while retaining one quota per IP and challenge.
    const challengeKey = crypto.createHash('sha256')
        .update(challengeIdentifier, 'utf8')
        .digest('hex');
    return `${req.ip || 'unknown'}:${challengeKey}`;
};

const buildUnavailableTotpRateLimiter = () => (_req, _res, next) => {
    next(new AppError(
        TOTP_VERIFY_RATE_LIMIT_UNAVAILABLE,
        503,
        'AUTH_RATE_LIMIT_UNAVAILABLE',
    ));
};

const buildTotpVerifyLimiter = () => {
    const options = {
        windowMs: TOTP_VERIFY_RATE_LIMIT_WINDOW_MS,
        max: 5, // 5 attempts per 5 minutes per IP and challenge
        message: {
            success: false,
            error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many 2FA attempts. Please try again later.' }
        },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: totpVerifyKeyGenerator,
    };

    // Keep isolated tests and local development on the repository's explicit
    // process-local fallback. A deployed process must not silently downgrade
    // this security boundary when its shared Redis store is unavailable.
    if (config.env === 'test' || config.env === 'development') {
        return rateLimit(options);
    }

    try {
        const { rateLimitRedis } = require('../../config/redis');
        if (!rateLimitRedis
            || rateLimitRedis._isMemoryFallback === true
            || ['end', 'closing'].includes(rateLimitRedis.status)
            || typeof rateLimitRedis.call !== 'function') {
            return buildUnavailableTotpRateLimiter();
        }

        const store = new RedisStore({
            prefix: TOTP_VERIFY_RATE_LIMIT_PREFIX,
            sendCommand: async (...args) => {
                try {
                    return await rateLimitRedis.call(...args);
                } catch (_error) {
                    throw new AppError(
                        TOTP_VERIFY_RATE_LIMIT_UNAVAILABLE,
                        503,
                        'AUTH_RATE_LIMIT_UNAVAILABLE',
                    );
                }
            },
        });

        // express-rate-limit's default is fail closed on store errors. Keep it
        // explicit so a future option change cannot turn Redis errors into an
        // unbounded 2FA endpoint.
        return rateLimit({
            ...options,
            store,
            passOnStoreError: false,
        });
    } catch (_error) {
        return buildUnavailableTotpRateLimiter();
    }
};

const totpVerifyLimiter = buildTotpVerifyLimiter();
router.post('/2fa/verify', totpVerifyLimiter, totpController.verify);
// POST /auth/2fa/disable — turn off 2FA (requires auth)
router.post('/2fa/disable', authenticate, totpController.disable);

// Session management routes
router.use('/sessions', require('./session.routes'));

// ADR M-004: native (body-token) auth — a clean, dedicated mount. Does NOT
// touch the /sessions mount above, including its pre-existing
// /api/auth/sessions/sessions double-mount, which is left exactly as-is.
router.use('/native', require('./native/native.routes'));

module.exports = router;
