/**
 * Payment Webhook Routes
 * Defines webhook endpoints for payment gateway callbacks
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const paymentWebhookController = require('./payment-webhook.controller');
const { validateWebhookSignature } = require('./webhook.middleware');

const router = express.Router();

// bKash sends at most one webhook per payment.  Allow a burst of 60/min to
// absorb legitimate retries without permitting brute-force signature probing.
const webhookRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    // Key by raw IP — X-Forwarded-For is already trusted in the app's trust-proxy config
    keyGenerator: (req) => req.ip,
    message: {
        success: false,
        message: 'Too many webhook requests. Please retry after a minute.'
    }
});

/**
 * bKash Payment Webhook
 * POST /api/webhooks/bkash/payment-status
 */
router.post(
    '/bkash/payment-status',
    webhookRateLimiter,
    validateWebhookSignature('bkash'),
    paymentWebhookController.handleBkashWebhook
);

module.exports = router;
