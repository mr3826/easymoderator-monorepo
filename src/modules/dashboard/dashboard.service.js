const { Order, Product, Channel, UserShop, Analytics } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { Op, fn, col, literal } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const cacheService = require('../../utils/cache.service');

const METRICS_CACHE_KEY = 'dashboard:metrics';
const METRICS_CACHE_TTL = 60; // seconds

/**
 * Verify user has access to shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};

/**
 * Get dashboard metrics for a shop.
 * Authorization is handled upstream by the auth middleware (JWT already contains
 * shopId set at login). verifyShopAccess is intentionally omitted here — it adds
 * a redundant UserShop DB query on every page load.
 */
const getDashboardMetrics = async (userId, shopId, period = 30) => {
    const cacheKey = `${METRICS_CACHE_KEY}:${period}`;
    const cached = await cacheService.getForShop(shopId, cacheKey);
    if (cached) return cached;

    // Date ranges — all derived from the requested period
    const today = new Date();
    const startOfToday   = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const periodDays     = Number(period) || 30;
    const startOfPeriod  = new Date(today.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const startOfLast    = new Date(today.getTime() - periodDays * 2 * 24 * 60 * 60 * 1000);

    const [
        totalMessages,
        messagesInPeriod,
        activeProducts,
        ordersToday,
        ordersInPeriod,
        ordersLastPeriod,
        activeChannels,
        totalChannels,
        chartRows,
        analyticsRow
    ] = await Promise.all([
        // All-time total messages
        Analytics.sum('total_messages', { where: { shop_id: shopId } }).then(v => Number(v) || 0),

        // Messages in selected period (conversion rate denominator)
        Analytics.sum('total_messages', {
            where: { shop_id: shopId, date: { [Op.gte]: startOfPeriod.toISOString().split('T')[0] } }
        }).then(v => Number(v) || 0),

        // Active products
        Product.count({ where: { shop_id: shopId, in_stock: true } }),

        // Orders today
        Order.count({ where: { shop_id: shopId, created_at: { [Op.gte]: startOfToday } } }),

        // Orders in selected period (conversion rate numerator + main order stat)
        Order.count({ where: { shop_id: shopId, created_at: { [Op.gte]: startOfPeriod } } }),

        // Orders in previous period (for period-over-period change %)
        Order.count({
            where: { shop_id: shopId, created_at: { [Op.gte]: startOfLast, [Op.lt]: startOfPeriod } }
        }),

        Channel.count({ where: { shop_id: shopId, is_active: true } }),
        Channel.count({ where: { shop_id: shopId } }),

        // Chart: orders per day over the selected period — single GROUP BY
        Order.findAll({
            attributes: [
                [fn('DATE', col('created_at')), 'date'],
                [fn('COUNT', col('id')), 'orders']
            ],
            where: { shop_id: shopId, created_at: { [Op.gte]: startOfPeriod } },
            group: [fn('DATE', col('created_at'))],
            order: [[fn('DATE', col('created_at')), 'ASC']],
            raw: true
        }),

        // Most recent daily analytics row (for AI metrics)
        Analytics.findOne({ where: { shop_id: shopId }, order: [['date', 'DESC']] })
    ]);

    const conversionRate = messagesInPeriod > 0
        ? (ordersInPeriod / messagesInPeriod) * 100
        : 0;

    const periodChange = ordersLastPeriod > 0
        ? ((ordersInPeriod - ordersLastPeriod) / ordersLastPeriod) * 100
        : 0;

    // Fill chart to always have `periodDays` data points
    const chartMap = new Map(chartRows.map(r => [r.date, parseInt(r.orders)]));
    const chartData = [];
    for (let i = periodDays - 1; i >= 0; i--) {
        const d   = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().split('T')[0];
        chartData.push({ date: key, orders: chartMap.get(key) || 0 });
    }

    const result = {
        metrics: {
            totalMessages,
            activeProducts:  activeProducts  || 0,
            ordersToday:     ordersToday     || 0,
            ordersInPeriod:  ordersInPeriod  || 0,
            conversionRate:  Math.round(conversionRate * 100) / 100,
            weeklyChange:    Math.round(periodChange   * 100) / 100,
        },
        channels:  { active: activeChannels || 0, total: totalChannels || 0 },
        chartData,
        analytics: analyticsRow || null,
        period:    periodDays,
    };

    await cacheService.setForShop(shopId, cacheKey, result, METRICS_CACHE_TTL).catch(() => {});
    return result;
};

/**
 * Get dashboard metrics by ID.
 * Dashboard data is always shop-scoped; the only valid ID is the shop's own ID.
 * Any other UUID returns null so the controller can 404.
 */
const getDashboardMetricsById = async (id, userId, shopId, period) => {
    if (id !== shopId) return null;
    return getDashboardMetrics(userId, shopId, period);
};

module.exports = {
    getDashboardMetrics,
    getDashboardMetricsById
};
