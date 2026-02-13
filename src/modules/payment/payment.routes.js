const express = require('express');
const paymentController = require('./payment.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const { 
    confirmCodPaymentValidator, 
    savePaymentConfigValidator, 
    initiatePaymentValidator 
} = require('./payment.validator');

const router = express.Router();

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
router.post('/aamarpay/success', paymentController.handleAamarPaySuccess);
router.post('/aamarpay/fail', paymentController.handleAamarPayFail);
router.post('/aamarpay/cancel', paymentController.handleAamarPayFail);

// SSLCommerz callbacks (no auth required - external callbacks)
router.post('/sslcommerz/success', paymentController.handleSSLCommerzSuccess);
router.post('/sslcommerz/fail', paymentController.handleSSLCommerzFail);
router.post('/sslcommerz/cancel', paymentController.handleSSLCommerzFail);
router.post('/sslcommerz/ipn', paymentController.handleSSLCommerzIPN);

module.exports = router;