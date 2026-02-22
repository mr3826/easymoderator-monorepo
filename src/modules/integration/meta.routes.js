const express = require('express');
const metaController = require('./meta.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const { verifyShopAccess } = require('src/middleware/shop-access.middleware');
const { validateRequest } = require('src/middleware/validate-request.middleware');
const { manualConnectSchema } = require('./meta.validator');

const router = express.Router();

// All routes require authentication and shop access
router.use(authenticate);
router.use(verifyShopAccess);

// Manual connect route (UI-provided credentials)
router.post('/manual-connect', validateRequest(manualConnectSchema), metaController.manualConnect);

// Management routes
router.get('/status', metaController.getStatus);
router.post('/disconnect', metaController.disconnect);

module.exports = router;
