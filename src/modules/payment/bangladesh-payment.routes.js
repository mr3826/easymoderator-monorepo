const express = require('express');
const { body, query } = require('express-validator');
const BangladeshPaymentController = require('./bangladesh-payment.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// All routes require authentication except /callback (inbound webhook from payment gateway)
router.use((req, res, next) => {
  if (req.path.startsWith('/callback')) return next();
  authenticate(req, res, next);
});

// Validation middleware
const validateInitializePayment = [
    body('payment_method').isIn(['bkash', 'nagad', 'COD']).withMessage('Invalid payment method'),
    body('order_id').notEmpty().withMessage('order_id is required'),
    body('amount').isNumeric().withMessage('amount must be a number'),
    body('amount').custom(value => value > 0).withMessage('amount must be greater than 0'),
    body('customer_name').notEmpty().withMessage('customer_name is required'),
    body('customer_phone').matches(/^01[3-9]\d{8}$/).withMessage('Invalid Bangladesh phone number'),
    body('callback_url').isURL().withMessage('callback_url must be a valid URL'),
    body('shop_id').notEmpty().withMessage('shop_id is required')
];

const validateVerifyPayment = [
    body('payment_method').isIn(['bkash', 'nagad']).withMessage('Invalid payment method'),
    body('payment_id').notEmpty().withMessage('payment_id is required')
];

const validateRefundPayment = [
    body('payment_method').isIn(['bkash']).withMessage('Refund only supported for bKash'),
    body('payment_id').notEmpty().withMessage('payment_id is required'),
    body('amount').isNumeric().withMessage('amount must be a number'),
    body('amount').custom(value => value > 0).withMessage('amount must be greater than 0'),
    body('reason').optional().isString().withMessage('reason must be a string')
];

const validateSimulatePayment = [
    body('payment_method').isIn(['bkash', 'nagad', 'COD']).withMessage('Invalid payment method'),
    body('order_id').notEmpty().withMessage('order_id is required'),
    body('amount').isNumeric().withMessage('amount must be a number'),
    body('amount').custom(value => value > 0).withMessage('amount must be greater than 0'),
    body('customer_name').notEmpty().withMessage('customer_name is required'),
    body('customer_phone').matches(/^01[3-9]\d{8}$/).withMessage('Invalid Bangladesh phone number'),
    body('shop_id').notEmpty().withMessage('shop_id is required'),
    body('simulate_status').optional().isIn(['success', 'failed', 'pending']).withMessage('Invalid simulate_status')
];

// Routes

/**
 * POST /api/payment/bangladesh/initialize
 * Initialize payment with bKash or Nagad
 */
router.post('/initialize', validateInitializePayment, BangladeshPaymentController.initializePayment);

/**
 * POST /api/payment/bangladesh/verify
 * Verify payment status
 */
router.post('/verify', validateVerifyPayment, BangladeshPaymentController.verifyPayment);

/**
 * POST /api/payment/bangladesh/callback/:payment_method
 * Process payment callback (webhook)
 */
router.post('/callback/:payment_method', BangladeshPaymentController.processCallback);

/**
 * GET /api/payment/bangladesh/status
 * Get payment status
 */
router.get('/status', BangladeshPaymentController.getPaymentStatus);

/**
 * POST /api/payment/bangladesh/refund
 * Refund payment (bKash only)
 */
router.post('/refund', validateRefundPayment, BangladeshPaymentController.refundPayment);

/**
 * GET /api/payment/bangladesh/methods
 * Get supported payment methods
 */
router.get('/methods', BangladeshPaymentController.getSupportedPaymentMethods);

/**
 * GET /api/payment/bangladesh/config/validate
 * Validate payment configuration
 */
router.get('/config/validate', BangladeshPaymentController.validatePaymentConfig);

// Development-only routes — blocked in production
const devOnly = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ message: 'Not found' });
  }
  next();
};

/**
 * GET /api/payment/bangladesh/test
 * Test payment integration (development only)
 */
router.get('/test', devOnly, BangladeshPaymentController.testPaymentIntegration);

/**
 * POST /api/payment/bangladesh/simulate
 * Simulate payment (development only — blocked in production)
 */
router.post('/simulate', devOnly, validateSimulatePayment, BangladeshPaymentController.simulatePayment);

module.exports = router;
