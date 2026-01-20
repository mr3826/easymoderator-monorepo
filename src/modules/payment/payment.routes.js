const express = require('express');
const paymentController = require('./payment.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const { confirmCodPaymentValidator } = require('./payment.validator');

const router = express.Router();

// All payment routes require authentication
router.use(authenticate);

// POST /payment/cod/confirm - Confirm COD payment
router.post('/cod/confirm', confirmCodPaymentValidator, paymentController.confirmCodPayment);

module.exports = router;