/**
 * Payment Methods Service
 * 
 * Provides methods to get available payment methods and payment method availability for shops
 * Used for order creation, payment buttons, and checkout flows
 * 
 * @file payment/payment-methods.service.js
 */

const { PaymentConfig, Shop } = require('../entities');
const { AppError } = require('../../utils/AppError');

/**
 * Get available payment methods for a shop (for order creation/checkout)
 * Returns only enabled methods with masked credentials
 * 
 * @param {string} shopId - The shop ID
 * @returns {Promise<Array>} Available payment methods with display info
 */
async function getAvailablePaymentMethods(shopId) {
  try {
    const methods = await PaymentConfig.findAll({
      where: {
        shop_id: shopId,
        is_enabled: true
      },
      attributes: ['id', 'gateway', 'created_at', 'updated_at']
    });

    // Map to display-friendly format
    const displayMethods = methods.map(method => ({
      id: method.id,
      gateway: method.gateway,
      displayName: getGatewayDisplayName(method.gateway),
      icon: getGatewayIcon(method.gateway),
      description: getGatewayDescription(method.gateway),
      isAvailable: true
    }));

    return displayMethods;
  } catch (error) {
    console.error('Error fetching available payment methods:', error);
    throw new AppError('Failed to fetch payment methods', 500);
  }
}

/**
 * Get payment method details including form fields (for frontend rendering)
 * @param {string} gateway - Gateway name (bkash, nagad, rocket, cod, etc.)
 * @returns {Object} Gateway template with fields
 */
function getPaymentMethodTemplate(gateway) {
  const templates = {
    bkash: {
      displayName: 'bKash',
      description: 'Mobile money payment gateway',
      icon: 'bkash',
      processingTime: '1-2 minutes'
    },
    nagad: {
      displayName: 'Nagad',
      description: 'Bangladesh mobile money service',
      icon: 'nagad',
      processingTime: '1-2 minutes'
    },
    rocket: {
      displayName: 'Rocket',
      description: 'Robi mobile money service',
      icon: 'rocket',
      processingTime: '1-2 minutes'
    },
    cod: {
      displayName: 'Cash on Delivery',
      description: 'Collect payment when customer receives order',
      icon: 'cod',
      processingTime: 'On delivery'
    }
  };

  return templates[gateway.toLowerCase()] || {
    displayName: gateway,
    description: 'Payment gateway',
    icon: 'payment',
    processingTime: 'Variable'
  };
}

/**
 * Get gateway display name
 */
function getGatewayDisplayName(gateway) {
  const names = {
    bkash: 'bKash',
    nagad: 'Nagad',
    rocket: 'Rocket',
    cod: 'Cash on Delivery'
  };
  return names[gateway.toLowerCase()] || gateway;
}

/**
 * Get gateway icon name
 */
function getGatewayIcon(gateway) {
  const icons = {
    bkash: 'bkash',
    nagad: 'nagad',
    rocket: 'rocket',
    cod: 'cash'
  };
  return icons[gateway.toLowerCase()] || 'payment';
}

/**
 * Get gateway description
 */
function getGatewayDescription(gateway) {
  const descriptions = {
    bkash: 'Mobile money payment gateway - Fast and secure',
    nagad: 'Bangladesh mobile money service - Safe payment',
    rocket: 'Robi mobile money service - Quick checkout',
    cod: 'Collect payment when customer receives order - No fees'
  };
  return descriptions[gateway.toLowerCase()] || 'Payment method';
}

/**
 * Check if a payment method is available for a shop
 * @param {string} shopId - Shop ID
 * @param {string} paymentMethodId - Payment method config ID
 * @returns {Promise<boolean>}
 */
async function isPaymentMethodAvailable(shopId, paymentMethodId) {
  const method = await PaymentConfig.findOne({
    where: {
      id: paymentMethodId,
      shop_id: shopId,
      is_enabled: true
    }
  });
  return !!method;
}

/**
 * Get payment method by ID and shop
 * @param {string} shopId - Shop ID
 * @param {string} paymentMethodId - Payment method ID
 * @returns {Promise<Object>} Payment method configuration
 */
async function getPaymentMethodById(shopId, paymentMethodId) {
  const method = await PaymentConfig.findOne({
    where: {
      id: paymentMethodId,
      shop_id: shopId
    },
    attributes: ['id', 'gateway', 'is_enabled', 'created_at', 'updated_at']
  });

  if (!method) {
    throw new AppError('Payment method not found', 404);
  }

  return {
    id: method.id,
    gateway: method.gateway,
    displayName: getGatewayDisplayName(method.gateway),
    isEnabled: method.is_enabled,
    template: getPaymentMethodTemplate(method.gateway)
  };
}

/**
 * Get default payment methods (for UI fallback)
 * Returns COD if no methods are connected
 */
function getDefaultPaymentMethods() {
  return [
    {
      gateway: 'cod',
      displayName: 'Cash on Delivery',
      description: 'Collect payment when customer receives order',
      icon: 'cod',
      isDefault: true
    }
  ];
}

/**
 * Generate payment method selection prompt for AI
 * Used to help AI select appropriate payment method during order creation
 */
async function generatePaymentMethodsPrompt(shopId) {
  const methods = await getAvailablePaymentMethods(shopId);
  
  if (methods.length === 0) {
    return 'Payment method: Cash on Delivery (COD)';
  }

  const methodsList = methods
    .map(m => `- ${m.displayName}`)
    .join('\n');

  return `Available payment methods:\n${methodsList}\n\nDefault: Cash on Delivery (COD)`;
}

module.exports = {
  getAvailablePaymentMethods,
  getPaymentMethodTemplate,
  getGatewayDisplayName,
  getGatewayIcon,
  getGatewayDescription,
  isPaymentMethodAvailable,
  getPaymentMethodById,
  getDefaultPaymentMethods,
  generatePaymentMethodsPrompt
};
