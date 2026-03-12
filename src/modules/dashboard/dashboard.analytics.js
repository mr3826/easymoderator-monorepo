const { Analytics, UserShop } = require('../entities');
const { AppError } = require('../../utils/AppError');

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

const logEvent = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);

    const date = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const dateKey = date.toISOString().split('T')[0];

    let row = await Analytics.findOne({
        where: {
            shop_id: shopId,
            date: dateKey
        }
    });

    if (!row) {
        row = await Analytics.create({
            shop_id: shopId,
            date: dateKey
        });
    }

    const updates = {
        total_messages: row.total_messages + (payload.event_type ? 1 : 0),
        llm_calls: row.llm_calls + (payload.metadata?.ai_model ? 1 : 0),
        cache_hits: row.cache_hits + (payload.metadata?.cache_hit ? 1 : 0),
        keyword_matches: row.keyword_matches + (payload.metadata?.keyword_match ? 1 : 0),
        cost_estimate: Number(row.cost_estimate) + Number(payload.metadata?.cost_estimate || 0)
    };

    await row.update(updates);

    return row;
};

const logMetric = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);

    const date = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const dateKey = date.toISOString().split('T')[0];

    let row = await Analytics.findOne({
        where: {
            shop_id: shopId,
            date: dateKey
        }
    });

    if (!row) {
        row = await Analytics.create({
            shop_id: shopId,
            date: dateKey
        });
    }

    if (payload.metric_type === 'response_time') {
        await row.update({
            cost_estimate: Number(row.cost_estimate)
        });
    }

    return row;
};

const getDashboardAnalytics = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const rows = await Analytics.findAll({
        where: { shop_id: shopId },
        order: [['date', 'ASC']]
    });

    const totals = rows.reduce(
        (acc, row) => {
            acc.total_messages += row.total_messages;
            acc.llm_calls += row.llm_calls;
            acc.cache_hits += row.cache_hits;
            acc.keyword_matches += row.keyword_matches;
            acc.cost_estimate += Number(row.cost_estimate);
            return acc;
        },
        {
            total_messages: 0,
            llm_calls: 0,
            cache_hits: 0,
            keyword_matches: 0,
            cost_estimate: 0
        }
    );

    return {
        totals,
        rows
    };
};

module.exports = {
    logEvent,
    logMetric,
    getDashboardAnalytics
};
