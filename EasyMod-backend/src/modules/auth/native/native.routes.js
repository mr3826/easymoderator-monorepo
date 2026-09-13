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

router.use((req, res, next) => {
    if (!config.mobileApiEnabled) {
        return next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
    }
    next();
});

router.post('/signin', validate(nativeSigninValidator), nativeAuthController.signin);
router.post('/2fa/verify', validate(native2faVerifyValidator), nativeAuthController.verifyTwoFactor);
router.post('/refresh', validate(nativeRefreshValidator), nativeAuthController.refresh);
router.post('/logout', authenticate, nativeAuthController.logout);
router.post('/switch-shop', authenticate, validate(switchShopValidator), nativeAuthController.switchShop);

// Own device sessions — see native-session.controller.js.
router.get('/sessions', authenticate, nativeSessionController.list);
router.delete('/sessions/:id', authenticate, nativeSessionController.revoke);

module.exports = router;
