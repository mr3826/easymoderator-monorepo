/**
 * templateRequired rule
 *
 * Meta 2026 retirement: CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE and
 * POST_PURCHASE_UPDATE are DEPRECATED (2026-02-09) and return error code 100
 * since 2026-04-27 — they must never be emitted; an outside-window send
 * without a currently-valid, evidence-backed tag is DENIED so the worker
 * holds it (merchant-visible recovery via the inbox action queue) instead of
 * firing a doomed request.
 *
 * HUMAN_AGENT is the only surviving tag class for this app's use case, is for
 * MANUAL representative replies (never automated sends), requires a separate
 * Meta App-Review permission this app has not yet been granted, and runs on a
 * 7-day clock measured from verified inbound evidence (twentyFourHourWindow
 * augments `human_agent_window_expired` when evidence exceeds it). The tag
 * path is gated behind META_HUMAN_AGENT_TAG_ENABLED (default off) so enabling
 * it is a deliberate, reviewed action once the permission is live.
 *
 * within_window=false + no currently-valid tag = DENY.
 */

'use strict';

// Retired at Meta (error 100 since 2026-04-27). Kept exported so provider and
// tests can classify historical values; they are NEVER allowed on the wire.
const RETIRED_TAGS = new Set([
    'CONFIRMED_EVENT_UPDATE',
    'POST_PURCHASE_UPDATE',
    'ACCOUNT_UPDATE',
]);

function humanAgentPermissionHeld() {
    return process.env.META_HUMAN_AGENT_TAG_ENABLED === 'true';
}

function isAllowedMessageTag(tag) {
    if (!tag) return false;
    if (RETIRED_TAGS.has(tag)) return false;
    if (tag === 'HUMAN_AGENT') return humanAgentPermissionHeld();
    return false;
}

module.exports = {
    name: 'templateRequired',

    async evaluate(message, ctx) {
        const augment = ctx.runningAugment || {};
        const withinWindow = augment.within_window !== false ? true : false;
        if (withinWindow) return { allow: true, reason: 'WITHIN_WINDOW' };

        const tag = augment.message_tag;
        const agentSend = message?.senderRole === 'agent';

        if (agentSend) {
            if (
                humanAgentPermissionHeld() &&
                tag === 'HUMAN_AGENT' &&
                !augment.human_agent_window_expired
            ) {
                return { allow: true, reason: 'OUTSIDE_WINDOW_TAGGED' };
            }
            return { allow: false, reason: 'HUMAN_AGENT_OUTSIDE_WINDOW_BLOCKED' };
        }

        if (tag === 'HUMAN_AGENT') {
            // Automated sends may not use HUMAN_AGENT even when permission is
            // granted — Meta's approved use is manual representative replies.
            return { allow: false, reason: 'HUMAN_AGENT_AUTOMATED_SEND_BLOCKED' };
        }

        if (tag && isAllowedMessageTag(tag) && !augment.human_agent_window_expired) {
            return { allow: true, reason: 'OUTSIDE_WINDOW_TAGGED' };
        }

        return { allow: false, reason: 'OUTSIDE_24H_TEMPLATES_DISABLED' };
    },
};

module.exports.RETIRED_TAGS = RETIRED_TAGS;
module.exports.isAllowedMessageTag = isAllowedMessageTag;
module.exports.humanAgentPermissionHeld = humanAgentPermissionHeld;
