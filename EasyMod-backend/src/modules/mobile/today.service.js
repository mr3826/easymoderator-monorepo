'use strict';

/**
 * ADR M-008 — `GET /api/mobile/today`. Day counts computed against the
 * Dhaka day boundary (D4), explicitly NOT reusing dashboard.service.js's
 * UTC-boundary "today" — see the M-008 Phase 2 amendment for why that is an
 * intentional, documented inconsistency rather than a silent one.
 */

const { Op } = require('sequelize');
const { Order } = require('../entities');
const { getMerchantDayWindowUtc } = require('./mobile-day-window.util');
const attentionService = require('./attention.service');

// D3: a draft order is not a committed order yet — it is surfaced as its own
// attention item (tier 3), not counted in the day's order volume/revenue.
const DRAFT_STATUS = 'draft';

async function getToday(shopId, shopTimezone, now = new Date()) {
    const window = getMerchantDayWindowUtc(shopTimezone, now);
    const { startUtc, endUtc } = window;

    const [ordersToday, deliveredTodayCount, signals] = await Promise.all([
        Order.findAll({
            where: {
                shop_id: shopId,
                created_at: { [Op.gte]: startUtc, [Op.lt]: endUtc },
            },
            attributes: ['id', 'order_status', 'total'],
        }),
        Order.count({
            where: {
                shop_id: shopId,
                delivered_at: { [Op.gte]: startUtc, [Op.lt]: endUtc },
            },
        }),
        // Reused, not re-derived: pending-action counts here must always
        // agree with what /api/mobile/attention would show for the same
        // shop at the same instant.
        attentionService.collectAllSignals(shopId, now),
    ]);

    const realOrders = ordersToday.filter((order) => order.order_status !== DRAFT_STATUS);
    const orderCount = realOrders.length;
    const revenue = realOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);

    const countBySignal = (...signalTypes) => signals.items
        .filter((item) => signalTypes.includes(item.signal_type))
        .length;

    const pendingActions = {
        draft_orders: countBySignal('DRAFT_ORDER'),
        needs_reply: countBySignal('INBOX_NEEDS_REPLY'),
        courier_problems: countBySignal('COURIER_FAILED', 'COURIER_INDETERMINATE', 'COURIER_SETUP_REQUIRED'),
        rto_verify: countBySignal('RTO_VERIFY'),
        low_stock: countBySignal('LOW_STOCK'),
    };

    return {
        date: window.dateLabel,
        order_count: orderCount,
        // Order-derived expectation, not a settlement fact (MOBILE_PRODUCT_SPEC.md §5) —
        // `total` is what the order says it is worth, not confirmed collected cash.
        revenue: Math.round(revenue * 100) / 100,
        delivered_count: deliveredTodayCount,
        pending_actions: pendingActions,
        timezone_used: window.timezoneUsed,
        timezone_note: window.timezoneNote,
        conversation_scan_truncated: signals.conversationScanTruncated,
        generated_at: now.toISOString(),
    };
}

module.exports = { getToday, DRAFT_STATUS };
