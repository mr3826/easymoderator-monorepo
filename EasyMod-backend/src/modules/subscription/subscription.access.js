'use strict';

/**
 * Subscription access helpers — pure, dependency-free predicates used by the
 * AI auto-reply path, jobs and middleware to decide whether *automated* AI
 * replies should run for a shop. Conversation-quota enforcement is separate
 * (see conversation-limit.middleware.js); this is purely about billing status.
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

/** Whether a subscription is currently inside its card-less 14-day trial. */
const isTrialing = (sub) => !!sub && String(sub.status || '').toLowerCase() === 'trialing';

module.exports = { isAiActive, isTrialing, AI_BLOCKED_STATUSES };
