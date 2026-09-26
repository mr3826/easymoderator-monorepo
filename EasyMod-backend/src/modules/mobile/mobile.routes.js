'use strict';

/**
 * ADR M-008 — mobile attention/today routes.
 *
 * Every route here is gated by MOBILE_API_ENABLED: 404 (not 401/403) when
 * off, per ADR M-010 — the flag-gate-first middleware and its
 * byte-identical 404 string are copied verbatim from
 * modules/auth/native/native.routes.js:28-33, so flag-off is
 * indistinguishable from a route that doesn't exist (matches the global
 * catch-all in app.js).
 *
 * Both routes are GET-only and read-only: authenticate + verifyShopAccess
 * (NOT requireShop, which skips the UserShop membership check), no
 * idempotency middleware needed.
 */

const express = require('express');
const config = require('../../config/config');
const { AppError } = require('../../utils/AppError');
const { authenticate } = require('../../middleware/auth.middleware');
const { verifyShopAccess } = require('../../middleware/shop-access.middleware');
const mobileController = require('./mobile.controller');
const { isMobileE2eFixturesEnabled } = require('./mobile-e2e-fixtures');

const router = express.Router();

router.use((req, res, next) => {
    if (!config.mobileApiEnabled) {
        return next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
    }
    next();
});

// Disposable device-E2E controls (mobile-e2e-fixtures.js). The route only
// exists when the process starts with NODE_ENV=test, the explicit fixture flag,
// a per-run token and a local disposable test database; in any other process it
// is never registered and falls through to the same 404 as an unknown path.
// Authenticated by the control token, not a user session, so it is mounted
// before `authenticate`.
if (isMobileE2eFixturesEnabled()) {
    router.post('/e2e/control', require('./mobile-e2e.controller').control);
}

router.use(authenticate);
router.use(verifyShopAccess);

router.get('/attention', mobileController.getAttention);
router.get('/today', mobileController.getToday);

module.exports = router;
