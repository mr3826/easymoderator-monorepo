const { Order, Product, Channel, UserShop, Analytics } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { Op } = require('sequelize');

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
 * Get dashboard metrics for a shop
 */
const getDashboardMetrics = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const analyticsRow = await Analytics.findOne({
        where: { shop_id: shopId },
        order: [['date', 'DESC']]
    });

    // Get date ranges
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfLastWeek = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Parallel queries for better performance
    const [
        totalMessages,
        activeProducts,
        ordersToday,
        ordersThisWeek,
        ordersLastWeek,
        activeChannels,
        totalChannels
    ] = await Promise.all([
        // Total messages (from analytics, since channel_configs has no message_count column)
        Promise.resolve(0),

        // Active products (model uses in_stock, not is_active)
        Product.count({ where: { shop_id: shopId, in_stock: true } }),

        // Orders today
        Order.count({
            where: {
                shop_id: shopId,
                created_at: { [Op.gte]: startOfToday }
            }
        }),

        // Orders this week
        Order.count({
            where: {
                shop_id: shopId,
                created_at: { [Op.gte]: startOfWeek }
            }
        }),

        // Orders last week
        Order.count({
            where: {
                shop_id: shopId,
                created_at: {
                    [Op.gte]: startOfLastWeek,
                    [Op.lt]: startOfWeek
                }
            }
        }),

        // Active channels (model uses is_active, not connected)
        Channel.count({ where: { shop_id: shopId, is_active: true } }),

        // Total channels
        Channel.count({ where: { shop_id: shopId } })
    ]);

    // Calculate conversion rate (orders / messages * 100, simplified)
    const conversionRate = totalMessages > 0 ? ((ordersToday / totalMessages) * 100) : 0;

    // Calculate weekly change
    const weeklyChange = ordersLastWeek > 0 ?
        ((ordersThisWeek - ordersLastWeek) / ordersLastWeek * 100) : 0;

    // Get chart data (orders per day for the last 7 days)
    const chartData = [];
    // Temporarily disabled chart data to fix 500 error
    // for (let i = 6; i >= 0; i--) {
    //     const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    //     const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    //     const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    //     const dayOrders = await Order.count({
    //         where: {
    //             shop_id: shopId,
    //             created_at: {
    //                 [Op.gte]: startOfDay,
    //                 [Op.lt]: endOfDay
    //             }
    //         }
    //     });

    //     chartData.push({
    //         date: date.toISOString().split('T')[0],
    //         orders: dayOrders
    //     });
    // }

    return {
        metrics: {
            totalMessages: analyticsRow?.total_messages || Number(totalMessages) || 0,
            activeProducts: activeProducts || 0,
            ordersToday: ordersToday || 0,
            conversionRate: Math.round(conversionRate * 100) / 100,
            weeklyChange: Math.round(weeklyChange * 100) / 100
        },
        channels: {
            active: activeChannels || 0,
            total: totalChannels || 0
        },
        chartData,
        analytics: analyticsRow || null
    };
};

/**
 * Get dashboard metrics by ID (placeholder for future use)
 */
const getDashboardMetricsById = async (id, userId, shopId) => {
    // For now, same as getDashboardMetrics
    return getDashboardMetrics(userId, shopId);
};

module.exports = {
    getDashboardMetrics,
    getDashboardMetricsById
};
