/**
 * templateRequired rule
 *
 * Pairs with twentyFourHourWindow: outside the 24h messaging window, Meta
 * requires a valid message tag on every send (Send API `tag` field) or the
 * message is rejected/undelivered. twentyFourHourWindow attaches a tag to
 * `augment.message_tag` for exactly this case — this rule just validates it
 * against Meta's current tag set (2020 consolidation; see
 * src/database/migrations/archive/20260320_004_add_hitl_and_message_tag.js)
 * and denies only when no valid tag is present.
 *
 * Human-agent replies (message.senderRole === 'agent') are blocked outright
 * outside the window, rather than tagged POST_PURCHASE_UPDATE like AI/system
 * sends: Meta ties tags to actual message content, and a free-form agent
 * chat reply isn't a purchase update. The correct tag for this case,
 * HUMAN_AGENT, requires a separate Meta permission this app has not
 * requested/received — see docs/meta-app-review.md. Once that's approved,
 * this can route to HUMAN_AGENT instead of blocking.
 *
 * Reads the running augment object that prior rules contributed to (the engine
 * merges augment per step). within_window=false + no valid tag = DENY.
 */

'use strict';

const ALLOWED_TAGS = new Set([
    'CONFIRMED_EVENT_UPDATE',
    'POST_PURCHASE_UPDATE',
    'ACCOUNT_UPDATE',
    'HUMAN_AGENT',
]);

// Applied by twentyFourHourWindow.rule when the caller doesn't request a
// specific (valid) tag. EasyModerator's out-of-window sends are order/support
// follow-ups, which POST_PURCHASE_UPDATE covers.
const DEFAULT_TAG = 'POST_PURCHASE_UPDATE';

module.exports = {
    name: 'templateRequired',

    async evaluate(message, ctx) {
        const augment = ctx.runningAugment || {};
        const withinWindow = augment.within_window !== false ? true : false;
        if (withinWindow) return { allow: true, reason: 'WITHIN_WINDOW' };

        if (message?.senderRole === 'agent') {
            return { allow: false, reason: 'HUMAN_AGENT_OUTSIDE_WINDOW_BLOCKED' };
        }

        if (augment.message_tag && ALLOWED_TAGS.has(augment.message_tag)) {
            return { allow: true, reason: 'OUTSIDE_WINDOW_TAGGED' };
        }

        return { allow: false, reason: 'OUTSIDE_24H_TEMPLATES_DISABLED' };
    },
};

module.exports.ALLOWED_TAGS = ALLOWED_TAGS;
module.exports.DEFAULT_TAG = DEFAULT_TAG;
