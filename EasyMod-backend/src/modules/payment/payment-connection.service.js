/**
 * Payment Connection Service
 * 
 * Handles saving, testing, and managing user-connected payment methods
 * 
 * @file payment/payment-connection.service.js
 */

const { PaymentConfig, Shop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const axios = require('axios');

/**
 * Payment gateway templates defining required credentials
 */
const GATEWAY_TEMPLATES = {
  bkash: {
    displayName: 'bKash',
    description: 'Mobile money payment gateway',
    fields: [
      { name: 'merchantId', label: 'Merchant ID', type: 'text', required: true, placeholder: 'Your bKash Merchant ID' },
      { name: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'API Key from bKash portal' },
      { name: 'secretKey', label: 'Secret Key', type: 'password', required: true, placeholder: 'Secret Key from bKash portal' },
      { name: 'username', label: 'Username', type: 'text', required: true, placeholder: 'bKash account username' },
      { name: 'password', label: 'Password', type: 'password', required: true, placeholder: 'bKash account password' }
    ],
    testEndpoint: 'https://api.bkash.com/api/v1/check-issuer',
    icon: 'bkash'
  },
  nagad: {
    displayName: 'Nagad',
    description: 'Bangladesh mobile money service',
    fields: [
      { name: 'merchantId', label: 'Merchant ID', type: 'text', required: true },
      { name: 'apiKey', label: 'API Key', type: 'password', required: true },
      { name: 'publicKey', label: 'Public Key', type: 'textarea', required: true }
    ],
    testEndpoint: 'https://api.nagad.io/merchant/verify',
    icon: 'nagad'
  },
  rocket: {
    displayName: 'Rocket',
    description: 'Robi mobile money service',
    fields: [
      { name: 'merchantId', label: 'Merchant ID', type: 'text', required: true },
      { name: 'apiKey', label: 'API Key', type: 'password', required: true },
      { name: 'serviceId', label: 'Service ID', type: 'text', required: true }
    ],
    testEndpoint: 'https://api.rocket.com.bd/v1/merchants/check',
    icon: 'rocket'
  },
  cod: {
    displayName: 'Cash on Delivery',
    description: 'Collect payment when customer receives order',
    fields: [], // COD requires no configuration
    testEndpoint: null,
    icon: 'cod'
  }
};

/**
 * Validate shop ownership
 */
async function verifyShopAccess(userId, shopId) {
  const shop = await Shop.findByPk(shopId);
  if (!shop) {
    throw new AppError('Shop not found', 404);
  }
  
  // TODO: Verify user is owner/admin of shop
  return shop;
}

/**
 * List all payment methods connected to a shop
 * Returns masked credentials (never full secrets)
 */
async function listPaymentMethods(shopId) {
  const methods = await PaymentConfig.findAll({
    where: { shop_id: shopId },
    attributes: ['id', 'gateway', 'is_enabled', 'created_at', 'updated_at']
  });

  return methods.map(method => ({
    id: method.id,
    gateway: method.gateway,
    displayName: GATEWAY_TEMPLATES[method.gateway]?.displayName || method.gateway,
    isEnabled: method.is_enabled,
    createdAt: method.created_at,
    updatedAt: method.updated_at,
    status: method.is_enabled ? 'active' : 'inactive'
  }));
}

/**
 * Save a new payment method with encrypted credentials
 */
async function savePaymentMethod(shopId, gateway, credentials) {
  // Validate gateway
  if (!GATEWAY_TEMPLATES[gateway]) {
    throw new AppError(`Unsupported payment gateway: ${gateway}`, 400);
  }

  // Validate credentials against template
  const template = GATEWAY_TEMPLATES[gateway];
  const requiredFields = template.fields.filter(f => f.required).map(f => f.name);
  
  for (const field of requiredFields) {
    if (!credentials[field]) {
      throw new AppError(`Missing required field: ${field}`, 400);
    }
  }

  // Check if already connected (optional: allow multiple of same gateway for different accounts)
  const existing = await PaymentConfig.findOne({
    where: { shop_id: shopId, gateway }
  });

  if (existing && gateway !== 'cod') {
    throw new AppError(`Payment method ${gateway} already connected. Delete existing one first.`, 409);
  }

  // Save with encrypted credentials
  const paymentMethod = await PaymentConfig.create({
    shop_id: shopId,
    gateway,
    credentials, // Model's setter automatically encrypts
    is_enabled: true
  });

  return {
    id: paymentMethod.id,
    gateway: paymentMethod.gateway,
    displayName: template.displayName,
    isEnabled: paymentMethod.is_enabled,
    createdAt: paymentMethod.created_at
  };
}

/**
 * Test a payment method connection
 * Validates credentials without storing them
 */
async function testPaymentMethod(gateway, credentials) {
  // COD doesn't need testing
  if (gateway === 'cod') {
    return { success: true, message: 'COD is always available' };
  }

  const template = GATEWAY_TEMPLATES[gateway];
  if (!template) {
    return { success: false, error: 'Unsupported gateway' };
  }

  if (!template.testEndpoint) {
    return { success: true, message: `${gateway} test not yet implemented, saving anyway` };
  }

  try {
    // Test different gateways with their specific test logic
    const result = await testGatewayConnection(gateway, credentials, template);
    return result;
  } catch (error) {
    console.error(`[Payment Test] Error testing ${gateway}:`, error.message);
    return {
      success: false,
      error: error.message || 'Connection test failed'
    };
  }
}

/**
 * Test connection for a saved payment method
 */
async function testPaymentMethodById(shopId, methodId) {
  const method = await PaymentConfig.findOne({
    where: { id: methodId, shop_id: shopId }
  });

  if (!method) {
    throw new AppError('Payment method not found', 404);
  }

  return testPaymentMethod(method.gateway, method.credentials);
}

/**
 * Update a payment method
 */
async function updatePaymentMethod(shopId, methodId, updates) {
  const method = await PaymentConfig.findOne({
    where: { id: methodId, shop_id: shopId }
  });

  if (!method) {
    throw new AppError('Payment method not found', 404);
  }

  // If updating credentials, validate them first
  if (updates.credentials) {
    const template = GATEWAY_TEMPLATES[method.gateway];
    const requiredFields = template.fields.filter(f => f.required).map(f => f.name);
    
    for (const field of requiredFields) {
      if (!updates.credentials[field]) {
        throw new AppError(`Missing required field: ${field}`, 400);
      }
    }
  }

  // Update
  await method.update({
    credentials: updates.credentials || method.credentials,
    is_enabled: updates.is_enabled !== undefined ? updates.is_enabled : method.is_enabled,
    updated_at: new Date()
  });

  return {
    id: method.id,
    gateway: method.gateway,
    displayName: GATEWAY_TEMPLATES[method.gateway].displayName,
    isEnabled: method.is_enabled,
    updatedAt: method.updated_at
  };
}

/**
 * Delete a payment method
 */
async function deletePaymentMethod(shopId, methodId) {
  const method = await PaymentConfig.findOne({
    where: { id: methodId, shop_id: shopId }
  });

  if (!method) {
    throw new AppError('Payment method not found', 404);
  }

  await method.destroy();
  return true;
}

/**
 * Test gateway-specific connections
 * Each gateway has different test logic
 */
async function testGatewayConnection(gateway, credentials, template) {
  switch (gateway) {
    case 'bkash':
      return await testBKashConnection(credentials);
    case 'nagad':
      return await testNagadConnection(credentials);
    case 'rocket':
      return await testRocketConnection(credentials);
    default:
      return { success: true, message: 'Test not implemented for this gateway' };
  }
}

/**
 * Test bKash connection
 */
async function testBKashConnection(credentials) {
  try {
    // Call bKash verification endpoint
    const response = await axios.post(
      'https://api.bkash.com/api/v1/check-issuer',
      { merchantId: credentials.merchantId },
      {
        headers: {
          'Authorization': `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    if (response.status === 200) {
      return { success: true, message: 'bKash connection verified' };
    }
  } catch (error) {
    return { success: false, error: error.response?.data?.message || 'Invalid bKash credentials' };
  }
}

/**
 * Test Nagad connection
 */
async function testNagadConnection(credentials) {
  try {
    const response = await axios.post(
      'https://api.nagad.io/merchant/verify',
      { merchantId: credentials.merchantId },
      {
        headers: {
          'Authorization': `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    return { success: true, message: 'Nagad connection verified' };
  } catch (error) {
    return { success: false, error: 'Invalid Nagad credentials' };
  }
}

/**
 * Test Rocket connection
 */
async function testRocketConnection(credentials) {
  try {
    const response = await axios.get(
      'https://api.rocket.com.bd/v1/merchants/check',
      {
        params: { merchantId: credentials.merchantId },
        headers: { 'Authorization': `Bearer ${credentials.apiKey}` },
        timeout: 5000
      }
    );

    return { success: true, message: 'Rocket connection verified' };
  } catch (error) {
    return { success: false, error: 'Invalid Rocket credentials' };
  }
}

/**
 * Get gateway templates (for frontend form rendering)
 */
function getGatewayTemplates() {
  return GATEWAY_TEMPLATES;
}

/**
 * Get available gateways list
 */
function getAvailableGateways() {
  return Object.keys(GATEWAY_TEMPLATES).map(key => ({
    id: key,
    name: GATEWAY_TEMPLATES[key].displayName,
    description: GATEWAY_TEMPLATES[key].description
  }));
}

module.exports = {
  listPaymentMethods,
  savePaymentMethod,
  testPaymentMethod,
  testPaymentMethodById,
  updatePaymentMethod,
  deletePaymentMethod,
  getGatewayTemplates,
  getAvailableGateways,
  GATEWAY_TEMPLATES
};
