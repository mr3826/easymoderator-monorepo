/**
 * twentyFourHourWindow rule
 *
 * Meta Platform Policy: outside the 24-hour standard messaging window, a send
 * requires a valid message tag (Send API `tag` field) or Meta will not
 * deliver it. This rule sets `augment.within_window`, and — when outside the
 * window — `augment.message_tag` too, for templateRequired (validation) and
 * MetaMessengerProvider (puts it on the wire) to consume.
 *
 * This rule never hard-denies by itself; templateRequired owns the deny.
 */

'use strict';

const consentService = require('../../consent/consent.service');
const { ALLOWED_TAGS, DEFAULT_TAG } = require('./templateRequired.rule');

const WINDOW_MS = 24 * 60 * 60 * 1000;

// A caller may request a specific valid tag via message.policy.messageTag
// (e.g. ACCOUNT_UPDATE for a shipping-address change); anything else falls
// back to DEFAULT_TAG rather than sending untagged.
function outsideWindowAugment(message) {
    const requested = message?.policy?.messageTag;
    const message_tag = requested && ALLOWED_TAGS.has(requested) ? requested : DEFAULT_TAG;
    return { within_window: false, message_tag };
}

module.exports = {
    name: 'twentyFourHourWindow',

    async evaluate(message, ctx) {
        const { customer, platform } = ctx;

        const lastInbound = consentService.getLastInboundAt({ customer, platform });
        if (!lastInbound) {
            // No inbound ever -> not within 24h window.
            return { allow: true, reason: 'NO_INBOUND', augment: outsideWindowAugment(message) };
        }

        const elapsedMs = Date.now() - lastInbound.getTime();
        if (elapsedMs <= WINDOW_MS) {
            return { allow: true, reason: 'WITHIN_WINDOW', augment: { within_window: true } };
        }

        return { allow: true, reason: 'OUTSIDE_WINDOW', augment: outsideWindowAugment(message) };
    },
};
