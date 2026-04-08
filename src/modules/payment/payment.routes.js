const express = require('express');
const rateLimit = require('express-rate-limit');
const paymentController = require('./payment.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const {
    paymentGatewayIpAllowlist,
    paymentCallbackHmacVerify,
    paymentCallbackPostOnly
} = require('../../middleware/payment-callback-auth.middleware');
const {
    confirmCodPaymentValidator,
    savePaymentConfigValidator,
    initiatePaymentValidator
} = require('./payment.validator');
const validate = require('../../middleware/validate.middleware');

const router = express.Router();

const paymentCallbackRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many callback requests, please retry later.'
    }
});

// Payment callback middleware: IP allowlist + POST only (applied to all callback routes)
const paymentCallbackAuth = [
    paymentCallbackRateLimiter,
    paymentCallbackPostOnly,
    paymentGatewayIpAllowlist,
    paymentCallbackHmacVerify
];

// Payment configuration routes (require authentication)
router.get('/config', authenticate, paymentController.getPaymentConfigs);
router.post('/config', authenticate, validate(savePaymentConfigValidator), paymentController.savePaymentConfig);
router.post('/config/test', authenticate, validate(savePaymentConfigValidator), paymentController.testPaymentConnection);
router.delete('/config/:gateway', authenticate, paymentController.deletePaymentConfig);

// Payment initiation (requires authentication)
router.post('/initiate', authenticate, validate(initiatePaymentValidator), paymentController.initiatePayment);

// COD payment confirmation (requires authentication)
router.post('/cod/confirm', authenticate, validate(confirmCodPaymentValidator), paymentController.confirmCodPayment);

// AamarPay callbacks (no auth required - external callbacks)
router.post('/aamarpay/success', paymentCallbackAuth, paymentController.handleAamarPaySuccess);
router.post('/aamarpay/fail', paymentCallbackAuth, paymentController.handleAamarPayFail);
router.post('/aamarpay/cancel', paymentCallbackAuth, paymentController.handleAamarPayFail);

// SSLCommerz callbacks (no auth required - external callbacks)
// Validation uses POST body only (not GET query string)
router.post('/sslcommerz/success', paymentCallbackAuth, paymentController.handleSSLCommerzSuccess);
router.post('/sslcommerz/fail', paymentCallbackAuth, paymentController.handleSSLCommerzFail);
router.post('/sslcommerz/cancel', paymentCallbackAuth, paymentController.handleSSLCommerzFail);
router.post('/sslcommerz/ipn', paymentCallbackAuth, paymentController.handleSSLCommerzIPN);

// Rocket callbacks (no auth required - external callbacks)
// Rocket MFS payment gateway for Bangladesh
router.post('/rocket/callback', paymentCallbackAuth, paymentController.handleRocketCallback);
router.post('/rocket/webhook', paymentCallbackAuth, paymentController.handleRocketWebhook);

module.exports = router;
