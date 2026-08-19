'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireGrowthOsAccess } = require('./growth-os.middleware');
const ctrl = require('./growth-os.controller');

const router = express.Router();

router.use(authenticate, requireGrowthOsAccess());
router.get('/session', ctrl.getSession);

module.exports = router;
