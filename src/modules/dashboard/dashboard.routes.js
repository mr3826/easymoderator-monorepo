const express = require('express');
const rateLimit = require('express-rate-limit');
const dashboardController = require('./dashboard.controller');
const dashboardValidator = require('./dashboard.validator');
const { validate } = require('../helpers');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireShop } = require('../../middleware/requireShop.middleware');

const router = express.Router();

// Rate limiting: 100 requests per 15 minutes per IP
const dashboardRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_ERROR',
            message: 'Too many requests from this IP, please try again later.'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// All dashboard routes require authentication
router.use(authenticate);
router.use(dashboardRateLimiter);
router.use(requireShop);

// RESTful routes
router.get('/queue', dashboardController.getTodayQueue);
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
