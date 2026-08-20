'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireGrowthOsAccess } = require('./growth-os.middleware');
const ctrl = require('./growth-os.controller');
const roleCtrl = require('./growth-os.roles.controller');

const router = express.Router();

router.use(authenticate, requireGrowthOsAccess());
router.get('/session', ctrl.getSession);
router.post('/roles', requireGrowthOsAccess('growth_os.roles.manage'), roleCtrl.grantRole);
router.delete('/roles/:userId', requireGrowthOsAccess('growth_os.roles.manage'), roleCtrl.revokeRole);

module.exports = router;
