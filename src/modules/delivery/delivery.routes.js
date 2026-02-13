const express = require('express');
const router = express.Router();
const deliveryController = require('./delivery.controller');
const { deliveryValidators, checkValidation } = require('./delivery.validator');
const { authenticate } = require('src/middleware/auth.middleware');

// All delivery routes require authentication
router.use(authenticate);

/**
 * GET /shop/delivery/settings
 * Get delivery provider settings for the shop
 */
router.get(
    '/settings',
    deliveryController.getSettings
);

/**
 * PUT /shop/delivery/settings
 * Update delivery settings for the shop
 */
router.put(
    '/settings',
    deliveryValidators.updateSettings,
    checkValidation,
    deliveryController.updateSettings
);

/**
 * POST /shop/delivery/connect
 * Connect a delivery provider
 */
router.post(
    '/connect',
    deliveryValidators.connectProvider,
    checkValidation,
    deliveryController.connectProvider
);

/**
 * POST /shop/delivery/disconnect
 * Disconnect a delivery provider
 */
router.post(
    '/disconnect',
    deliveryValidators.disconnectProvider,
    checkValidation,
    deliveryController.disconnectProvider
);

/**
 * POST /shop/delivery/toggle
 * Toggle provider active status
 */
router.post(
    '/toggle',
    deliveryValidators.toggleProvider,
    checkValidation,
    deliveryController.toggleProvider
);

/**
 * POST /shop/delivery/test
 * Test provider connection
 */
router.post(
    '/test',
    deliveryValidators.disconnectProvider, // Reuse same validation (just needs provider)
    checkValidation,
    deliveryController.testConnection
);

/**
 * GET /shop/delivery/:provider/stores
 * Get stores for a provider (Pathao only)
 */
router.get(
    '/:provider/stores',
    deliveryController.getProviderStores
);

/**
 * PUT /shop/delivery/:provider/metadata
 * Update provider metadata
 */
router.put(
    '/:provider/metadata',
    deliveryController.updateMetadata
);

module.exports = router;
