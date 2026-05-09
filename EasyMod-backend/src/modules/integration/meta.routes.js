const express = require('express');
const metaController = require('./meta.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { verifyShopAccess } = require('../../middleware/shop-access.middleware');
const validate = require('../../middleware/validate.middleware');
const { manualConnectSchema } = require('./meta.validator');

const router = express.Router();

// All routes require authentication and shop access
router.use(authenticate);
router.use(verifyShopAccess);

// Manual connect route (UI-provided credentials)
router.post('/manual-connect', validate(manualConnectSchema), metaController.manualConnect);

// Management routes
router.get('/status', metaController.getStatus);
router.post('/disconnect', metaController.disconnect);

module.exports = router;
