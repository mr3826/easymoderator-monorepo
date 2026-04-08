/**
 * Payment Webhook Routes
 * Defines webhook endpoints for payment gateway callbacks
 */

const express = require('express');
const paymentWebhookController = require('./payment-webhook.controller');
const { validateWebhookSignature } = require('./webhook.middleware');

const router = express.Router();

/**
 * bKash Payment Webhook
 * POST /api/webhooks/bkash/payment-status
 */
router.post(
    '/bkash/payment-status',
    validateWebhookSignature('bkash'),
    paymentWebhookController.handleBkashWebhook
);

/**
 * Nagad Payment Webhook
 * POST /api/webhooks/nagad/payment-status
 */
router.post(
    '/nagad/payment-status',
    validateWebhookSignature('nagad'),
    paymentWebhookController.handleNagadWebhook
);

/**
 * AamarPay Payment Webhook
 * POST /api/webhooks/aamarpay/payment-status
 */
router.post(
    '/aamarpay/payment-status',
    validateWebhookSignature('aamarpay'),
    paymentWebhookController.handleAamarPayWebhook
);

/**
 * SSLCommerz Payment Webhook
 * POST /api/webhooks/sslcommerz/payment-status
 */
router.post(
    '/sslcommerz/payment-status',
    validateWebhookSignature('sslcommerz'),
    paymentWebhookController.handleSSLCommerzWebhook
);

/**
 * Owner Payment Confirmation Webhook
 * POST /api/webhooks/owner/payment-confirmation/:notificationId/:action
 */
router.post('/owner/payment-confirmation/:notificationId/:action', 
    paymentWebhookController.handleOwnerPaymentConfirmation
);

module.exports = router;
