const express = require('express');
const paymentController = require('./payment.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const {
    paymentGatewayIpAllowlist,
    paymentCallbackPostOnly
} = require('src/middleware/payment-callback-auth.middleware');
const {
    confirmCodPaymentValidator,
    savePaymentConfigValidator,
    initiatePaymentValidator
} = require('./payment.validator');

const router = express.Router();

// Payment callback middleware: IP allowlist + POST only (applied to all callback routes)
const paymentCallbackAuth = [paymentCallbackPostOnly, paymentGatewayIpAllowlist];

// Payment configuration routes (require authentication)
router.get('/config', authenticate, paymentController.getPaymentConfigs);
router.post('/config', authenticate, savePaymentConfigValidator, paymentController.savePaymentConfig);
router.post('/config/test', authenticate, savePaymentConfigValidator, paymentController.testPaymentConnection);
router.delete('/config/:gateway', authenticate, paymentController.deletePaymentConfig);

// Payment initiation (requires authentication)
router.post('/initiate', authenticate, initiatePaymentValidator, paymentController.initiatePayment);

// COD payment confirmation (requires authentication)
router.post('/cod/confirm', authenticate, confirmCodPaymentValidator, paymentController.confirmCodPayment);

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

module.exports = router;
