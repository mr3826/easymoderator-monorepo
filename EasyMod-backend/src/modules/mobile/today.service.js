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

const {
    COMMITTED_ORDER_STATUSES,
    activeOrderWhere,
} = attentionService;

// Drafts are surfaced as their own attention item (tier 3), not counted in
// the day's committed order volume/expected value. The positive status
// allowlist also excludes terminal, cancelled, refunded, and legacy statuses.
const DRAFT_STATUS = 'draft';
const REVENUE_BASIS = 'expected_order_value';

async function getToday(shopId, shopTimezone, now = new Date()) {
    const window = getMerchantDayWindowUtc(shopTimezone, now);
    const { startUtc, endUtc } = window;

    const [ordersToday, deliveredTodayCount, signals] = await Promise.all([
        Order.findAll({
            where: {
                shop_id: shopId,
                created_at: { [Op.gte]: startUtc, [Op.lt]: endUtc },
                ...activeOrderWhere(COMMITTED_ORDER_STATUSES),
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

    // Keep the defensive status check because this value is merchant-facing
    // and must remain correct if a future query change broadens the result.
    const realOrders = ordersToday.filter((order) => COMMITTED_ORDER_STATUSES.includes(order.order_status));
    const orderCount = realOrders.length;
    const expectedOrderValue = Math.round(
        realOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0) * 100,
    ) / 100;

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
        expected_order_value: expectedOrderValue,
        // Compatibility alias retained for existing mobile clients. Both fields
        // intentionally carry the same order-derived expectation.
        revenue: expectedOrderValue,
        revenue_basis: REVENUE_BASIS,
        delivered_count: deliveredTodayCount,
        pending_actions: pendingActions,
        timezone_used: window.timezoneUsed,
        timezone_note: window.timezoneNote,
        conversation_scan_truncated: signals.conversationScanTruncated,
        generated_at: now.toISOString(),
    };
}

module.exports = { getToday, DRAFT_STATUS, REVENUE_BASIS };
