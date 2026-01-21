const express = require('express');
const metaController = require('./meta.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const { verifyShopAccess } = require('src/middleware/shop-access.middleware');

const router = express.Router();

// All routes require authentication and shop access
router.use(authenticate);
router.use(verifyShopAccess);

// OAuth flow routes
router.get('/connect', metaController.connect);
router.get('/callback', metaController.callback);

// Management routes
router.get('/status', metaController.getStatus);
router.post('/disconnect', metaController.disconnect);

module.exports = router;