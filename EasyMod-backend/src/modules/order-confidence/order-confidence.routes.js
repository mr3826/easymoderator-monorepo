'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { verifyShopAccess } = require('../../middleware/shop-access.middleware');
const { requireOwnerOrAdmin } = require('../../middleware/shop-permission.middleware');
const { validate } = require('../helpers');
const controller = require('./order-confidence.controller');
const schemas = require('./order-confidence.validator');

const router = express.Router();

// Every route: verified JWT + active shop membership (sets req.userRole).
router.use(authenticate, verifyShopAccess);

router.get('/orders/:orderId', validate(schemas.getDecision), controller.getDecision);
// Any shop role may record that a VERIFY order was confirmed with the customer.
router.post('/orders/:orderId/verify', validate(schemas.verify), controller.verify);
// MANUAL_REVIEW approval is an override: owner/admin only (also re-checked in the service).
router.post('/orders/:orderId/approve', requireOwnerOrAdmin, validate(schemas.approve), controller.approve);
router.get('/summary', requireOwnerOrAdmin, validate(schemas.summary), controller.summary);

module.exports = router;
