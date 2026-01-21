const express = require('express');
const dashboardController = require('./dashboard.controller');
const dashboardValidator = require('./dashboard.validator');
const { validate } = require('../helpers');
const { authenticate } = require('src/middleware/auth.middleware');

const router = express.Router();

// All dashboard routes require authentication
router.use(authenticate);

// RESTful routes
router.get('/', validate(dashboardValidator.getDashboardMetrics), dashboardController.getDashboardMetricsRest);
router.get('/:id', validate(dashboardValidator.getDashboardMetricsById), dashboardController.getDashboardMetricsById);

// Legacy routes for backward compatibility
router.get('/metrics', validate(dashboardValidator.getDashboardMetrics), dashboardController.getDashboardMetrics);

module.exports = router;