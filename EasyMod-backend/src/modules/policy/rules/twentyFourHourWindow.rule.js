/**
 * twentyFourHourWindow rule
 *
 * Meta Platform Policy: outside the 24-hour standard messaging window, the
 * outbound message MUST carry a `messaging_type=MESSAGE_TAG` with one of the
 * approved tags (CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE, ACCOUNT_UPDATE).
 *
 * This rule is INFORMATIONAL — it does NOT hard-deny by itself. It sets
 * `augment.message_tag` for the templateRequired rule to consume. If the caller
 * already provided a tag on the message, we pass it through unchanged.
 */

'use strict';

const consentService = require('../../consent/consent.service');

const WINDOW_MS = 24 * 60 * 60 * 1000;

module.exports = {
    name: 'twentyFourHourWindow',

    async evaluate(message, ctx) {
        const { customer, platform } = ctx;

        if (message?.policy?.messageTag) {
            return {
                allow: true,
                reason: 'TAG_PRESENT',
                augment: { message_tag: message.policy.messageTag, within_window: false },
            };
        }

        const lastInbound = consentService.getLastInboundAt({ customer, platform });
        if (!lastInbound) {
            // No inbound ever -> not within 24h window.
            return { allow: true, reason: 'NO_INBOUND', augment: { within_window: false } };
        }

        const elapsedMs = Date.now() - lastInbound.getTime();
        if (elapsedMs <= WINDOW_MS) {
            return { allow: true, reason: 'WITHIN_WINDOW', augment: { within_window: true } };
        }

        return { allow: true, reason: 'OUTSIDE_WINDOW', augment: { within_window: false } };
    },
};
