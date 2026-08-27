const express = require('express');
const router = express.Router();
const deliveryController = require('./delivery.controller');
const { deliveryValidators } = require('./delivery.validator');
const { authenticate } = require('../../middleware/auth.middleware');
const { verifyShopAccess } = require('../../middleware/shop-access.middleware');
const { requireOwner } = require('../../middleware/shop-permission.middleware');
const validate = require('../../middleware/validate.middleware');

// All delivery routes require authentication
router.use(authenticate);
router.use(verifyShopAccess);

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
    requireOwner,
    validate(deliveryValidators.updateSettings),
    deliveryController.updateSettings
);

/**
 * POST /shop/delivery/connect
 * Connect a delivery provider
 */
router.post(
    '/connect',
    requireOwner,
    validate(deliveryValidators.connectProvider),
    deliveryController.connectProvider
);

/**
 * POST /shop/delivery/disconnect
 * Disconnect a delivery provider
 */
router.post(
    '/disconnect',
    requireOwner,
    validate(deliveryValidators.disconnectProvider),
    deliveryController.disconnectProvider
);

/**
 * POST /shop/delivery/toggle
 * Toggle provider active status
 */
router.post(
    '/toggle',
    requireOwner,
    validate(deliveryValidators.toggleProvider),
    deliveryController.toggleProvider
);

/**
 * POST /shop/delivery/test
 * Test provider connection
 */
router.post(
    '/test',
    requireOwner,
    validate(deliveryValidators.disconnectProvider), // Reuse same validation (just needs provider)
    deliveryController.testConnection
);

/**
 * GET /shop/delivery/:provider/stores
 * Get stores for a provider (Pathao only)
 */
router.get(
    '/:provider/stores',
    requireOwner,
    deliveryController.getProviderStores
);

/**
 * PUT /shop/delivery/:provider/metadata
 * Update provider metadata
 */
router.put(
    '/:provider/metadata',
    requireOwner,
    validate(deliveryValidators.updateMetadata),
    deliveryController.updateMetadata
);

module.exports = router;
