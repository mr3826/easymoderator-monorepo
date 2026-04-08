const express = require('express');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const config = require('../../config/config');
const authController = require('./auth.controller');
const sessionController = require('./session.controller');
const totpController = require('./totp.controller');
const { signupValidator, signinValidator, refreshTokenValidator, forgotPasswordValidator, resetPasswordValidator } = require('./auth.validator');
const { authenticate } = require('../../middleware/auth.middleware');
const validate = require('../../middleware/validate.middleware');

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

// POST /auth/logout - Logout and revoke token
router.post('/logout', authenticate, authController.logout);

// 2FA / TOTP routes
// POST /auth/2fa/setup   — generate secret (requires auth)
router.post('/2fa/setup', authenticate, totpController.setup);
// POST /auth/2fa/enable  — activate with first token (requires auth)
router.post('/2fa/enable', authenticate, totpController.enable);
// POST /auth/2fa/verify  — step-2 login (no auth header — uses tempToken in body)
router.post('/2fa/verify', totpController.verify);
// POST /auth/2fa/disable — turn off 2FA (requires auth)
router.post('/2fa/disable', authenticate, totpController.disable);

// Session management routes
router.use('/sessions', require('./session.routes'));

module.exports = router;
