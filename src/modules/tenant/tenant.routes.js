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

// GET /tenant/white-label - Get white-label branding config for current shop
router.get('/white-label', tenantController.getWhiteLabel);

// PUT /tenant/white-label - Update white-label branding config for current shop
router.put('/white-label', tenantController.updateWhiteLabel);

// GET /tenant/white-label/css - Get CSS custom properties for current shop branding
router.get('/white-label/css', tenantController.getWhiteLabelCss);

module.exports = router;
