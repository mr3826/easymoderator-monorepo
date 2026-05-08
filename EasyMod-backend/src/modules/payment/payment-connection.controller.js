/**
 * Payment Method Connection API
 * 
 * Allows users to connect and manage their own payment gateway credentials
 * (bKash, Nagad, Rocket, COD, Aamarpay, SSLCommerz)
 * 
 * All credentials are stored encrypted (AES-256) on the backend.
 * 
 * @file payment/payment-connection.controller.js
 */

const { Router } = require('express');
const { PaymentConfig, Shop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const paymentConnectionService = require('./payment-connection.service');
const { authenticate: auth } = require('../../middleware/auth.middleware');

const router = Router();

/**
 * GET /payment/methods
 * 
 * List all connected payment methods for the shop
 * Returns: [{ id, gateway, is_enabled, created_at, status, last_test }]
 * Credentials are NOT returned to frontend
 */
router.get('/methods', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const methods = await paymentConnectionService.listPaymentMethods(shopId);
    
    res.status(200).json({
      success: true,
      data: methods,
      count: methods.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /payment/connect
 * 
 * Connect a new payment method
 * Body: { gateway, credentials }
 * 
 * Example (bKash):
 * {
 *   "gateway": "bkash",
 *   "credentials": {
 *     "merchantId": "XXXXXX",
 *     "apiKey": "xxxxxxxxxxxxxx",
 *     "secretKey": "xxxxxxxxxxxxxx",
 *     "username": "xxxxx",
 *     "password": "xxxxx"
 *   }
 * }
 */
router.post('/connect', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { gateway, credentials, testConnection } = req.body;

    // Validate input
    if (!gateway || !credentials) {
      throw new AppError('gateway and credentials required', 400);
    }

    // If testConnection=true, validate before saving
    if (testConnection) {
      const testResult = await paymentConnectionService.testPaymentMethod(
        gateway,
        credentials
      );

      if (!testResult.success) {
        throw new AppError(`Connection test failed: ${testResult.error}`, 400);
      }
    }

    // Save encrypted credentials
    const paymentMethod = await paymentConnectionService.savePaymentMethod(
      shopId,
      gateway,
      credentials
    );

    res.status(201).json({
      success: true,
      message: 'Payment method connected successfully',
      data: paymentMethod
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /payment/:methodId/test-connection
 * 
 * Test connection to a payment method
 * Returns: { success, message, error? }
 */
router.post('/:methodId/test-connection', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { methodId } = req.params;

    const result = await paymentConnectionService.testPaymentMethodById(
      shopId,
      methodId
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /payment/:methodId
 * 
 * Update a payment method (credentials or enable/disable)
 * Body: { credentials?, is_enabled? }
 */
router.put('/:methodId', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { methodId } = req.params;
    const { credentials, is_enabled } = req.body;

    const updated = await paymentConnectionService.updatePaymentMethod(
      shopId,
      methodId,
      { credentials, is_enabled }
    );

    res.status(200).json({
      success: true,
      message: 'Payment method updated',
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /payment/:methodId
 * 
 * Disconnect/delete a payment method
 */
router.delete('/:methodId', auth, async (req, res, next) => {
  try {
    const shopId = req.user.shopId;
    const { methodId } = req.params;

    await paymentConnectionService.deletePaymentMethod(shopId, methodId);

    res.status(200).json({
      success: true,
      message: 'Payment method disconnected'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payment/gateways/templates
 * 
 * Get credential field requirements for each gateway
 * Returns: { bkash: [...fields], nagad: [...fields], etc. }
 * 
 * Useful for frontend to render dynamic forms
 */
router.get('/gateways/templates', async (req, res, next) => {
  try {
    const templates = paymentConnectionService.getGatewayTemplates();
    
    res.status(200).json({
      success: true,
      data: templates
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
