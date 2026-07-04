'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const setupController = require('./setup.controller');

const router = express.Router();

router.use(authenticate);

router.get('/status', setupController.getSetupStatus);

module.exports = router;
