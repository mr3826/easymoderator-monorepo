const dashboardService = require('./dashboard.service');
const auditService = require('../audit/audit.service');

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
    // Legacy methods for backward compatibility
    getDashboardMetrics
};