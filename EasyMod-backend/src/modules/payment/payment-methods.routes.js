const express = require('express');
const paymentMethodsController = require('./payment-methods.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { verifyShopAccess } = require('../../middleware/shop-access.middleware');
const { requireOwner } = require('../../middleware/shop-permission.middleware');

const router = express.Router();

/**
 * Payment Methods Routes
 * 
 * Endpoints for managing and retrieving available payment methods
 * All endpoints require authentication
 */

// GET /payment-methods/available
// Get available payment methods for the authenticated user's shop
// Used for order creation and payment selection UI
router.get('/available', authenticate, verifyShopAccess, paymentMethodsController.getAvailablePaymentMethods);

// GET /payment-methods/get-config
// Get payment methods configuration for the shop
// Returns configuration for all payment methods
router.get('/get-config', authenticate, verifyShopAccess, paymentMethodsController.getPaymentMethodsConfig);

// POST /payment-methods/save-config
// Save payment methods configuration for the shop
// Updates the payment methods settings and enabled state
router.post('/save-config', authenticate, verifyShopAccess, requireOwner, paymentMethodsController.savePaymentMethodsConfig);

module.exports = router;
