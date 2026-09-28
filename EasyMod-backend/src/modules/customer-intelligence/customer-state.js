'use strict';

/**
 * Customer lifecycle state — derived, never stored (ADR-0005).
 *
 * Deterministic: the same recorded facts always give the same state, and the
 * state always carries the reasons that produced it. No AI output is an input.
 * The first matching rule wins; the order below is the precedence.
 */

const RULES_VERSION = 'customer-state/1.0.0';
const INACTIVE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const STATES = Object.freeze({
    AT_RISK: 'AT_RISK',
    INACTIVE: 'INACTIVE',
    REPEAT_BUYER: 'REPEAT_BUYER',
    BUYER: 'BUYER',
    INTERESTED: 'INTERESTED',
    NEW: 'NEW',
});

/**
 * @param {object} facts
 * @param {object} facts.summary            summarizeOrders() output
 * @param {string|Date|null} facts.lastActivityAt
 * @param {boolean} facts.hasLiveOpportunity
 * @param {Date} [now]
 */
function deriveCustomerState({ summary, lastActivityAt = null, hasLiveOpportunity = false }, now = new Date()) {
    const delivered = summary?.delivered_orders || 0;
    const returned = summary?.returned_orders || 0;
    const nonCancelled = (summary?.total_orders || 0) - (summary?.cancelled_orders || 0);
    const make = (state, code, params = {}) => ({
        state,
        reasons: [{ code, params }],
        rules_version: RULES_VERSION,
    });

    if (returned > 0 && returned >= delivered) {
        return make(STATES.AT_RISK, 'RETURNS_NOT_LESS_THAN_DELIVERIES', { returned, delivered });
    }

    if (lastActivityAt) {
        const inactiveDays = Math.floor((now.getTime() - new Date(lastActivityAt).getTime()) / DAY_MS);
        if (inactiveDays > INACTIVE_AFTER_DAYS) {
            return make(STATES.INACTIVE, 'NO_ACTIVITY', { days: inactiveDays, threshold_days: INACTIVE_AFTER_DAYS });
        }
    }

    if (delivered >= 2) return make(STATES.REPEAT_BUYER, 'MULTIPLE_DELIVERIES', { delivered });
    if (nonCancelled >= 1) return make(STATES.BUYER, 'HAS_ORDER', { orders: nonCancelled, delivered });
    if (hasLiveOpportunity) return make(STATES.INTERESTED, 'OPEN_OPPORTUNITY');
    return make(STATES.NEW, 'NO_ORDERS_YET');
}

module.exports = { RULES_VERSION, INACTIVE_AFTER_DAYS, STATES, deriveCustomerState };
