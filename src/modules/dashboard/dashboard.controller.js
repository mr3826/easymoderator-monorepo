const dashboardService = require('./dashboard.service');
const auditService = require('../audit/audit.service');
const dashboardAnalytics = require('./dashboard.analytics');

/**
 * RESTful: Get dashboard metrics
 */
const getDashboardMetricsRest = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const metrics = await dashboardService.getDashboardMetrics(req.user.userId, shopId);

        // Audit log dashboard access
        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'DASHBOARD_ACCESS',
            resourceType: 'DASHBOARD',
            resourceId: shopId, // Use shop ID as resource ID for dashboard
            metadata: { endpoint: req.originalUrl, action: 'view_metrics' },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            data: metrics
        });
    } catch (error) {
        next(error);
    }
};

const logAnalyticsEvent = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const row = await dashboardAnalytics.logEvent(req.user.userId, shopId, req.body);

        res.status(201).json({
            event_id: String(row.id),
            logged: true
        });
    } catch (error) {
        next(error);
    }
};

const logAnalyticsMetric = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        await dashboardAnalytics.logMetric(req.user.userId, shopId, req.body);

        res.status(201).json({
            recorded: true
        });
    } catch (error) {
        next(error);
    }
};

const getAnalyticsDashboard = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const data = await dashboardAnalytics.getDashboardAnalytics(req.user.userId, shopId);

        res.status(200).json({
            total_messages: data.totals.total_messages,
            avg_response_time_ms: 0,
            intent_breakdown: {},
            handover_rate: 0,
            customer_satisfaction: 0,
            error_rate: 0
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Get dashboard metrics by ID
 */
const getDashboardMetricsById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const metrics = await dashboardService.getDashboardMetricsById(id, req.user.userId, shopId);

        // Audit log dashboard access
        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'DASHBOARD_ACCESS',
            resourceType: 'DASHBOARD',
            resourceId: id,
            metadata: { endpoint: req.originalUrl, action: 'view_metrics_by_id' },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            data: metrics
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Get dashboard metrics (backward compatibility)
 */
const getDashboardMetrics = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const metrics = await dashboardService.getDashboardMetrics(req.user.userId, shopId);

        res.status(200).json({
            success: true,
            data: metrics
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    // RESTful methods
    getDashboardMetricsRest,
    getDashboardMetricsById,
    logAnalyticsEvent,
    logAnalyticsMetric,
    getAnalyticsDashboard,
    // Legacy methods for backward compatibility
    getDashboardMetrics
};