const express = require('express');
const { body, param } = require('express-validator');
const DeliveryRAGController = require('./delivery-rag.controller');

const router = express.Router();

// Validation middleware
const validateAddDeliveryZone = [
    body('shop_id').notEmpty().withMessage('shop_id is required'),
    body('zone_name').notEmpty().withMessage('zone_name is required'),
    body('areas').isArray({ min: 1 }).withMessage('areas must be a non-empty array'),
    body('areas.*').notEmpty().withMessage('each area must be a non-empty string'),
    body('delivery_charge').isNumeric().withMessage('delivery_charge must be a number'),
    body('estimated_time').optional().isString().withMessage('estimated_time must be a string'),
    body('metadata').optional().isObject().withMessage('metadata must be an object')
];

const validateMatchAddress = [
    body('shop_id').notEmpty().withMessage('shop_id is required'),
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
    body('shop_id').notEmpty().withMessage('shop_id is required'),
    body('zone_name').notEmpty().withMessage('zone_name is required'),
    body('order_value').isNumeric().withMessage('order_value must be a number')
];

const validateBatchAddDeliveryZones = [
    body('shop_id').notEmpty().withMessage('shop_id is required'),
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
router.post('/initialize', DeliveryRAGController.initializeCollections);

/**
 * POST /api/delivery/rag/zones
 * Add new delivery zone
 */
router.post('/zones', validateAddDeliveryZone, DeliveryRAGController.addDeliveryZone);

/**
 * POST /api/delivery/rag/zones/batch
 * Batch add delivery zones
 */
router.post('/zones/batch', validateBatchAddDeliveryZones, DeliveryRAGController.batchAddDeliveryZones);

/**
 * GET /api/delivery/rag/zones
 * Get all delivery zones for a shop
 */
router.get('/zones', DeliveryRAGController.getDeliveryZones);

/**
 * PUT /api/delivery/rag/zones/:shop_id/:zone_name
 * Update delivery zone
 */
router.put('/zones/:shop_id/:zone_name', validateUpdateDeliveryZone, DeliveryRAGController.updateDeliveryZone);

/**
 * DELETE /api/delivery/rag/zones/:shop_id/:zone_name
 * Delete delivery zone
 */
router.delete('/zones/:shop_id/:zone_name', DeliveryRAGController.deleteDeliveryZone);

/**
 * POST /api/delivery/rag/match-address
 * Match address to delivery zone
 */
router.post('/match-address', validateMatchAddress, DeliveryRAGController.matchAddress);

/**
 * POST /api/delivery/rag/calculate-charge
 * Calculate delivery charge
 */
router.post('/calculate-charge', validateCalculateDeliveryCharge, DeliveryRAGController.calculateDeliveryCharge);

/**
 * GET /api/delivery/rag/stats
 * Get delivery statistics
 */
router.get('/stats', DeliveryRAGController.getDeliveryStats);

/**
 * GET /api/delivery/rag/test
 * Test address matching with sample data
 */
router.get('/test', DeliveryRAGController.testAddressMatching);

module.exports = router;
