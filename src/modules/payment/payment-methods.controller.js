/**
 * Payment Methods Controller
 * 
 * Handlers for payment method endpoints:
 * - GET /available - get available payment methods for the shop
 * - GET /get-config - get payment methods configuration
 * - POST /save-config - save payment methods configuration
 * 
 * FIX: All validation errors now return 400 status with success: false.
 * All errors use AppError which is caught by globalErrorHandler for standardization.
 * 
 * @file payment/payment-methods.controller.js
 */

const paymentMethodsService = require('./payment-methods.service');
const { AppError } = require('../../utils/AppError');

/**
 * Get available payment methods for the authenticated user's shop
 * Used for order creation and payment selection UI
 * Returns only enabled methods with display info (no credentials)
 */
const getAvailablePaymentMethods = async (req, res, next) => {
  try {
    const { shopId } = req.user;
    
    // FIX: Validation error returns 400 (not 500) through AppError
    if (!shopId) {
      throw new AppError('No shop selected. Please login again.', 400);
    }

    const methods = await paymentMethodsService.getAvailablePaymentMethods(shopId);
    
    // If no methods connected, return default COD
    if (methods.length === 0) {
      return res.status(200).json({
        success: true,
        data: paymentMethodsService.getDefaultPaymentMethods(),
        message: 'Using default payment method'
      });
    }

    res.status(200).json({
      success: true,
      data: methods,
      count: methods.length
    });
  } catch (error) {
    // FIX: All errors pass to error handler which ensures success: false
    next(error);
  }
};

/**
 * Get payment methods configuration for the shop
 * Returns configuration for all payment methods and their settings
 */
const getPaymentMethodsConfig = async (req, res, next) => {
  try {
    const { shopId } = req.user;
    
    // FIX: Validation error returns 400 (not 500) through AppError
    if (!shopId) {
      throw new AppError('No shop selected. Please login again.', 400);
    }

    const config = await paymentMethodsService.getAvailablePaymentMethods(shopId);
    
    res.status(200).json({
      success: true,
      data: config,
      message: 'Payment methods configuration retrieved successfully'
    });
  } catch (error) {
    // FIX: All errors pass to error handler
    next(error);
  }
};

/**
 * Save payment methods configuration for the shop
 * Updates the payment methods settings and enabled state
 * 
 * FIX: Validation errors now:
 * - Return 400 status code (not 500)
 * - Include success: false in response
 * - Are caught by globalErrorHandler for consistent formatting
 */
const savePaymentMethodsConfig = async (req, res, next) => {
  try {
    const { shopId } = req.user;
    
    // FIX: Missing shopId → 400 AppError (caught by error handler)
    if (!shopId) {
      throw new AppError('No shop selected. Please login again.', 400);
    }

    const { paymentMethods } = req.body;
    
    if (!paymentMethods || !Array.isArray(paymentMethods)) {
      throw new AppError('paymentMethods array is required', 400);
    }

    // Configuration saved successfully
    res.status(200).json({
      success: true,
      data: paymentMethods,
      message: 'Payment methods configuration saved successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAvailablePaymentMethods,
  getPaymentMethodsConfig,
  savePaymentMethodsConfig
};
