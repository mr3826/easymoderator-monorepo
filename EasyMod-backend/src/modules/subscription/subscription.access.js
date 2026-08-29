'use strict';

/**
 * Subscription access helpers — pure, dependency-free predicates used by the
 * AI auto-reply path, jobs and middleware to decide whether *automated* AI
 * replies should run for a shop. Quota predicates are kept pure here so the
 * worker, jobs, and API serializers share the same entitlement calculation.
 *
 * Design: fail OPEN. Consistent with the rest of the codebase (the rate
 * limiter, getShopPlanCode and the conversation-limit middleware all fail
 * open), AI is blocked ONLY for explicitly inactive billing states. A missing
 * subscription row or an unknown status never locks a shop out of AI.
 */

// Billing states in which automated AI replies must be paused.
const AI_BLOCKED_STATUSES = Object.freeze(['trial_expired', 'suspended', 'cancelled', 'inactive']);

/**
 * Whether automated AI replies are allowed for a subscription's billing status.
 * @param {{status?: string}|null|undefined} sub
 * @returns {boolean}
 */
const isAiActive = (sub) => {
    if (!sub) return true; // fail-open: no row → don't block
    return !AI_BLOCKED_STATUSES.includes(String(sub.status || '').toLowerCase());
};

/** Whether a legacy pre-migration subscription is still marked trialing. */
const isTrialing = (sub) => !!sub && String(sub.status || '').toLowerCase() === 'trialing';

/**
 * Effective conversation allowance for the current period.
 * Missing subscriptions fail open as unlimited, matching isAiActive().
 * @param {{conversations_limit?: number, topup_balance?: number}|null|undefined} sub
 * @returns {number} -1 means unlimited
 */
const effectiveConversationLimit = (sub) => {
    if (!sub) return -1;

    const baseLimit = Number(sub.conversations_limit);
    if (!Number.isFinite(baseLimit) || baseLimit < 0) return -1;

    const topupBalance = Math.max(0, Number(sub.topup_balance) || 0);
    return baseLimit + topupBalance;
};

/**
 * Whether the subscription has no allowance left for a new conversation.
 * A missing row and unlimited plans fail open.
 * @param {{conversations_limit?: number, topup_balance?: number, conversations_used?: number}|null|undefined} sub
 * @returns {boolean}
 */
const isConversationQuotaExhausted = (sub) => {
    if (!sub) return false;
    const limit = effectiveConversationLimit(sub);
    if (limit < 0) return false;
    return Math.max(0, Number(sub.conversations_used) || 0) >= limit;
};

module.exports = {
    isAiActive,
    isTrialing,
    effectiveConversationLimit,
    isConversationQuotaExhausted,
    AI_BLOCKED_STATUSES
};
