const dashboardService = require('./dashboard.service');
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

        const period = parseInt(req.query.period) || 30;
        const metrics = await dashboardService.getDashboardMetrics(req.user.userId, shopId, period);

        res.status(200).json({ success: true, data: metrics });
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

        const row = await dashboardAnalytics.logEvent(shopId, req.body);

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

        await dashboardAnalytics.logMetric(shopId, req.body);

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

        const data = await dashboardAnalytics.getDashboardAnalytics(shopId);

        res.status(200).json({
            total_messages:      data.totals.total_messages,
            llm_calls:           data.totals.llm_calls,
            cache_hits:          data.totals.cache_hits,
            keyword_matches:     data.totals.keyword_matches,
            cost_estimate:       data.totals.cost_estimate,
            avg_response_time_ms: 0,
            intent_breakdown:    {},
            handover_rate:       0,
            customer_satisfaction: 0,
            error_rate:          0
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

        const { id } = req.params;
        const period  = parseInt(req.query.period) || 30;
        const metrics = await dashboardService.getDashboardMetricsById(id, req.user.userId, shopId, period);

        if (!metrics) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Dashboard not found.' } });
        }

        res.status(200).json({ success: true, data: metrics });
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

        const period  = parseInt(req.query.period) || 30;
        const metrics = await dashboardService.getDashboardMetrics(req.user.userId, shopId, period);

        res.status(200).json({ success: true, data: metrics });
    } catch (error) {
        next(error);
    }
};

/**
 * Bug #15: Lazy chart endpoint — returns only the GROUP-BY order-per-day data.
 * Called after the KPI summary is already rendered so the heavy query doesn't
 * block the initial page paint.
 */
const getDashboardChart = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }
        const period    = parseInt(req.query.period) || 30;
        const chartData = await dashboardService.getDashboardChart(shopId, period);
        res.status(200).json({ success: true, data: chartData });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    // RESTful methods
    getDashboardMetricsRest,
    getDashboardMetricsById,
    getDashboardChart,
    logAnalyticsEvent,
    logAnalyticsMetric,
    getAnalyticsDashboard,
    // Legacy methods for backward compatibility
    getDashboardMetrics
};
