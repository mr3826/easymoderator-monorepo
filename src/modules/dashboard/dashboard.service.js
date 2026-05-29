const { Order, Product, Channel, UserShop, Analytics } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { Op, fn, col } = require('sequelize');
const cacheService = require('../../utils/cache.service');

// Bug #15 fix: raise TTL from 60 s to 300 s.  KPI counts change at most once
// per new order/message, not every second.  The chart endpoint is split out so
// the fast summary loads first and the heavier GROUP-BY query loads lazily.
const SUMMARY_CACHE_TTL = 300; // 5 minutes
const CHART_CACHE_TTL   = 600; // 10 minutes — chart data is even more stable

/**
 * Get dashboard KPI summary (fast — 6 COUNT/SUM queries run in parallel).
 * Authorization is handled upstream by the auth middleware.
 */
const getDashboardMetrics = async (userId, shopId, period = 30) => {
    const periodDays = Number(period) || 30;
    const cacheKey   = `dashboard:summary:${periodDays}`;
    const cached     = await cacheService.getForShop(shopId, cacheKey);
    if (cached) return cached;

    const today         = new Date();
    const startOfToday  = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfPeriod = new Date(today.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const startOfLast   = new Date(today.getTime() - periodDays * 2 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
        totalMessages,
        messagesInPeriod,
        activeProducts,
        ordersToday,
        ordersInPeriod,
        ordersLastPeriod,
        activeChannels,
        totalChannels,
        analyticsRow,
        inTransitRow,
        atRiskRow
    ] = await Promise.all([
        Analytics.sum('total_messages', { where: { shop_id: shopId } }).then(v => Number(v) || 0),
        Analytics.sum('total_messages', {
            where: { shop_id: shopId, date: { [Op.gte]: startOfPeriod.toISOString().split('T')[0] } }
        }).then(v => Number(v) || 0),
        Product.count({ where: { shop_id: shopId, in_stock: true } }),
        Order.count({ where: { shop_id: shopId, created_at: { [Op.gte]: startOfToday } } }),
        Order.count({ where: { shop_id: shopId, created_at: { [Op.gte]: startOfPeriod } } }),
        Order.count({
            where: { shop_id: shopId, created_at: { [Op.gte]: startOfLast, [Op.lt]: startOfPeriod } }
        }),
        Channel.count({ where: { shop_id: shopId, is_active: true } }),
        Channel.count({ where: { shop_id: shopId } }),
        Analytics.findOne({ where: { shop_id: shopId }, order: [['date', 'DESC']] }),
        Order.findAll({
            where: {
                shop_id: shopId,
                delivery_status: { [Op.in]: ['booked', 'picked_up', 'in_transit', 'out_for_delivery'] },
                delivery_dispatched_at: { [Op.ne]: null }
            },
            attributes: [
                [fn('COALESCE', fn('SUM', col('total')), 0), 'amount'],
                [fn('COUNT', col('id')), 'count']
            ],
            raw: true
        }),
        Order.findAll({
            where: {
                shop_id: shopId,
                delivery_status: { [Op.in]: ['failed_delivery', 'returned'] },
                updated_at: { [Op.gte]: thirtyDaysAgo }
            },
            attributes: [
                [fn('COALESCE', fn('SUM', col('total')), 0), 'amount'],
                [fn('COUNT', col('id')), 'count']
            ],
            raw: true
        })
    ]);

    const conversionRate = messagesInPeriod > 0
        ? (ordersInPeriod / messagesInPeriod) * 100
        : 0;
    const periodChange = ordersLastPeriod > 0
        ? ((ordersInPeriod - ordersLastPeriod) / ordersLastPeriod) * 100
        : 0;

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
        analytics: analyticsRow || null,
        period:    periodDays,
        cashPosition: {
            inTransit: {
                amount: Number(inTransitRow?.[0]?.amount) || 0,
                count:  Number(inTransitRow?.[0]?.count)  || 0
            },
            atRisk: {
                amount:     Number(atRiskRow?.[0]?.amount) || 0,
                count:      Number(atRiskRow?.[0]?.count)  || 0,
                windowDays: 30
            }
        }
    };

    await cacheService.setForShop(shopId, cacheKey, result, SUMMARY_CACHE_TTL).catch(() => {});
    return result;
};

/**
 * Get chart data (orders per day) separately.
 * The GROUP-BY query is heavier; keeping it out of the critical path means the
 * dashboard KPI cards appear immediately while the chart loads lazily.
 */
const getDashboardChart = async (shopId, period = 30) => {
    const periodDays = Number(period) || 30;
    const cacheKey   = `dashboard:chart:${periodDays}`;
    const cached     = await cacheService.getForShop(shopId, cacheKey);
    if (cached) return cached;

    const today         = new Date();
    const startOfPeriod = new Date(today.getTime() - periodDays * 24 * 60 * 60 * 1000);

    const chartRows = await Order.findAll({
        attributes: [
            [fn('DATE', col('created_at')), 'date'],
            [fn('COUNT', col('id')), 'orders']
        ],
        where: { shop_id: shopId, created_at: { [Op.gte]: startOfPeriod } },
        group: [fn('DATE', col('created_at'))],
        order: [[fn('DATE', col('created_at')), 'ASC']],
        raw: true
    });

    const chartMap  = new Map(chartRows.map(r => [r.date, parseInt(r.orders)]));
    const chartData = [];
    for (let i = periodDays - 1; i >= 0; i--) {
        const d   = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().split('T')[0];
        chartData.push({ date: key, orders: chartMap.get(key) || 0 });
    }

    await cacheService.setForShop(shopId, cacheKey, chartData, CHART_CACHE_TTL).catch(() => {});
    return chartData;
};

/**
 * Combined helper kept for backward compatibility with existing controller calls.
 * Returns summary + chartData in one payload.
 */
const getDashboardMetricsById = async (id, userId, shopId, period) => {
    if (id !== shopId) return null;
    const [summary, chartData] = await Promise.all([
        getDashboardMetrics(userId, shopId, period),
        getDashboardChart(shopId, period)
    ]);
    return { ...summary, chartData };
};

module.exports = {
    getDashboardMetrics,
    getDashboardChart,
    getDashboardMetricsById
};
