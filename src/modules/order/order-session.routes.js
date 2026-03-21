const express = require('express');
const { body } = require('express-validator');
const OrderSessionController = require('./order-session.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// Order sessions are tenant-scoped resources and require authentication.
router.use(authenticate);

// Validation middleware
const validateStartSession = [
    body('customer_channel_id').notEmpty().withMessage('customer_channel_id is required'),
    body('channel').optional().isIn(['messenger', 'instagram', 'whatsapp']).withMessage('Invalid channel'),
    body('initial_message').optional().isString(),
    body('entities').optional().isObject(),
    body('product_info').optional().isObject()
];

const validateProcessStep = [
    body('answer').notEmpty().withMessage('answer is required'),
    body('raw_message').optional().isString()
];

// Routes

/**
 * POST /api/order-session/start
 * Start a new order session
 */
router.post('/start', validateStartSession, OrderSessionController.startOrderSession);

/**
 * GET /api/order-session/active
 * Get active session for a customer
 * Query params: shop_id, customer_id
 */
router.get('/active', OrderSessionController.getActiveSession);

/**
 * POST /api/order-session/:id/step
 * Process a step in the order flow
 */
router.post('/:id/step', validateProcessStep, OrderSessionController.processStep);

/**
 * GET /api/order-session/:id/state
 * Get session state
 */
router.get('/:id/state', OrderSessionController.getSessionState);

/**
 * POST /api/order-session/:id/confirm
 * Confirm order (equivalent to answering YES to summary)
 */
router.post('/:id/confirm', OrderSessionController.confirmOrder);

/**
 * POST /api/order-session/:id/cancel
 * Cancel session
 */
router.post('/:id/cancel', OrderSessionController.cancelSession);

module.exports = router;
