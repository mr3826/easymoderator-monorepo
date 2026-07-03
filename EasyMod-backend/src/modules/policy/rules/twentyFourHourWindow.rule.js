/**
 * twentyFourHourWindow rule
 *
 * Meta Platform Policy: outside the 24-hour standard messaging window, do not
 * send customer messages until a Meta-compliant template/messaging path is
 * implemented and approved for production use. Legacy Messenger message tags
 * are deprecated and must not be passed through to the provider.
 *
 * This rule is INFORMATIONAL — it does NOT hard-deny by itself. It sets
 * `augment.within_window` for the templateRequired rule to consume.
 */

'use strict';

const consentService = require('../../consent/consent.service');

const WINDOW_MS = 24 * 60 * 60 * 1000;

module.exports = {
    name: 'twentyFourHourWindow',

    async evaluate(message, ctx) {
        const { customer, platform } = ctx;

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
