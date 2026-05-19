/**
 * templateRequired rule
 *
 * Pairs with twentyFourHourWindow: if we're outside the 24h messaging window
 * AND the message does not carry a Meta-approved message tag, hard-deny.
 *
 * Reads the running augment object that prior rules contributed to (the engine
 * merges augment per step). within_window=false + no message_tag = DENY.
 */

'use strict';

const ALLOWED_TAGS = new Set([
    'CONFIRMED_EVENT_UPDATE',
    'POST_PURCHASE_UPDATE',
    'ACCOUNT_UPDATE',
    'HUMAN_AGENT',
]);

module.exports = {
    name: 'templateRequired',

    async evaluate(_message, ctx) {
        const augment = ctx.runningAugment || {};
        const withinWindow = augment.within_window !== false ? true : false;
        if (withinWindow) return { allow: true, reason: 'WITHIN_WINDOW' };

        const tag = augment.message_tag;
        if (tag && ALLOWED_TAGS.has(tag)) {
            return { allow: true, reason: 'TAG_OK' };
        }
        return { allow: false, reason: 'OUTSIDE_24H' };
    },
};

module.exports.ALLOWED_TAGS = ALLOWED_TAGS;
