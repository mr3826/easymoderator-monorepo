const express = require('express');
const { body, param } = require('express-validator');
const DeliveryRAGController = require('./delivery-rag.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const {
    requirePlatformAdmin,
    PLATFORM_ROLES,
} = require('../../middleware/platform-admin.middleware');

const router = express.Router();
const superAdminOnly = requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN);

router.use(authenticate);

function bindAuthenticatedShop(req, res, next) {
    const shopId = req.user?.shopId;
    if (!shopId) {
        return res.status(400).json({
            success: false,
            error: 'No authenticated shop selected',
        });
    }
    const requestedShop = req.body?.shop_id
        || req.params?.shop_id
        || req.query?.shop_id;
    if (requestedShop && String(requestedShop) !== String(shopId)) {
        return res.status(403).json({
            success: false,
            error: 'Cross-shop delivery access is forbidden',
        });
    }
    req.authenticatedShopId = shopId;
    return next();
}

// Validation middleware
const validateAddDeliveryZone = [
    body('shop_id').optional().isUUID().withMessage('shop_id must be a UUID'),
    body('zone_name').notEmpty().withMessage('zone_name is required'),
    body('areas').isArray({ min: 1 }).withMessage('areas must be a non-empty array'),
    body('areas.*').notEmpty().withMessage('each area must be a non-empty string'),
    body('delivery_charge').isNumeric().withMessage('delivery_charge must be a number'),
    body('estimated_time').optional().isString().withMessage('estimated_time must be a string'),
    body('metadata').optional().isObject().withMessage('metadata must be an object')
];

const validateMatchAddress = [
    body('shop_id').optional().isUUID().withMessage('shop_id must be a UUID'),
    body('address').notEmpty().withMessage('address is required')
];

const validateUpdateDeliveryZone = [
    param('shop_id').notEmpty().withMessage('shop_id is required'),
    param('zone_name').notEmpty().withMessage('zone_name is required'),
    body('delivery_charge').optional().isNumeric().withMessage('delivery_charge must be a number'),
    body('estimated_time').optional().isString().withMessage('estimated_time must be a string'),
    body('areas').optional().isArray().withMessage('areas must be an array'),
    body('metadata').optional().isObject().withMessage('metadata must be an object')
];

const validateCalculateDeliveryCharge = [
    body('shop_id').optional().isUUID().withMessage('shop_id must be a UUID'),
    body('zone_name').notEmpty().withMessage('zone_name is required'),
    body('order_value').isNumeric().withMessage('order_value must be a number')
];

const validateBatchAddDeliveryZones = [
    body('shop_id').optional().isUUID().withMessage('shop_id must be a UUID'),
    body('zones').isArray({ min: 1 }).withMessage('zones must be a non-empty array'),
    body('zones.*.zone_name').notEmpty().withMessage('each zone must have a zone_name'),
    body('zones.*.areas').isArray({ min: 1 }).withMessage('each zone must have areas array'),
    body('zones.*.delivery_charge').isNumeric().withMessage('each zone must have delivery_charge')
];

// Routes

/**
 * POST /api/delivery/rag/initialize
 * Initialize delivery RAG collections
 */
router.post('/initialize', superAdminOnly, DeliveryRAGController.initializeCollections);

/**
 * POST /api/delivery/rag/zones
 * Add new delivery zone
 */
router.post(
    '/zones',
    bindAuthenticatedShop,
    validateAddDeliveryZone,
    DeliveryRAGController.addDeliveryZone,
);

/**
 * POST /api/delivery/rag/zones/batch
 * Batch add delivery zones
 */
router.post(
    '/zones/batch',
    bindAuthenticatedShop,
    validateBatchAddDeliveryZones,
    DeliveryRAGController.batchAddDeliveryZones,
);

/**
 * GET /api/delivery/rag/zones
 * Get all delivery zones for a shop
 */
router.get('/zones', bindAuthenticatedShop, DeliveryRAGController.getDeliveryZones);

/**
 * PUT /api/delivery/rag/zones/:shop_id/:zone_name
 * Update delivery zone
 */
router.put(
    '/zones/:shop_id/:zone_name',
    bindAuthenticatedShop,
    validateUpdateDeliveryZone,
    DeliveryRAGController.updateDeliveryZone,
);

/**
 * DELETE /api/delivery/rag/zones/:shop_id/:zone_name
 * Delete delivery zone
 */
router.delete(
    '/zones/:shop_id/:zone_name',
    bindAuthenticatedShop,
    DeliveryRAGController.deleteDeliveryZone,
);

/**
 * POST /api/delivery/rag/match-address
 * Match address to delivery zone
 */
router.post(
    '/match-address',
    bindAuthenticatedShop,
    validateMatchAddress,
    DeliveryRAGController.matchAddress,
);

/**
 * POST /api/delivery/rag/calculate-charge
 * Calculate delivery charge
 */
router.post(
    '/calculate-charge',
    bindAuthenticatedShop,
    validateCalculateDeliveryCharge,
    DeliveryRAGController.calculateDeliveryCharge,
);

/**
 * GET /api/delivery/rag/stats
 * Get delivery statistics
 */
router.get('/stats', bindAuthenticatedShop, DeliveryRAGController.getDeliveryStats);

/**
 * GET /api/delivery/rag/test
 * Test address matching with sample data
 */
router.get('/test', bindAuthenticatedShop, DeliveryRAGController.testAddressMatching);

module.exports = router;
module.exports._private = { bindAuthenticatedShop };
