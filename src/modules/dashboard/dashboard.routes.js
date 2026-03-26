const express = require('express');
const dashboardController = require('./dashboard.controller');
const dashboardValidator = require('./dashboard.validator');
const { validate } = require('../helpers');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// All dashboard routes require authentication
router.use(authenticate);

// RESTful routes
router.get('/', validate(dashboardValidator.getDashboardMetrics), dashboardController.getDashboardMetricsRest);

// Bug #15: separate chart route — loaded lazily after KPI summary renders
router.get('/chart', dashboardController.getDashboardChart);

// Analytics endpoints
router.post('/analytics/events', dashboardController.logAnalyticsEvent);
router.post('/analytics/metrics', dashboardController.logAnalyticsMetric);
router.get('/analytics/dashboard', dashboardController.getAnalyticsDashboard);

// Legacy routes for backward compatibility
router.get('/metrics', validate(dashboardValidator.getDashboardMetrics), dashboardController.getDashboardMetrics);

router.get('/:id', validate(dashboardValidator.getDashboardMetricsById), dashboardController.getDashboardMetricsById);

module.exports = router;
