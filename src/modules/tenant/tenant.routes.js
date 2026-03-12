const express = require('express');
const tenantController = require('./tenant.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validateRequest } = require('../../middleware/validate-request.middleware');
const tenantValidator = require('./tenant.validator');

const router = express.Router();

// All tenant routes require authentication 
router.use(authenticate);

// GET /tenant/:tenantId - Get tenant details
router.get('/:tenantId',
    validateRequest(tenantValidator.getTenantValidator),
    tenantController.getTenant
);

// GET /tenant/:tenantId/shops - Get tenant shops
router.get('/:tenantId/shops',
    validateRequest(tenantValidator.getTenantValidator),
    tenantController.getTenantShops
);

// GET /tenant/:tenantId/shop/:shopId - Get specific tenant shop
router.get('/:tenantId/shop/:shopId',
    validateRequest(tenantValidator.getTenantShopValidator),
    tenantController.getTenantShop
);

// GET /tenant/:tenantId/validate - Validate tenant
router.get('/:tenantId/validate',
    validateRequest(tenantValidator.getTenantValidator),
    tenantController.validateTenant
);

module.exports = router;
