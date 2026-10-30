/**
 * twentyFourHourWindow rule
 *
 * Meta Platform Policy: outside the 24-hour standard messaging window an
 * untagged send is not delivered. This rule sets `augment.within_window` and,
 * when outside the window, augments ONLY a currently-valid, explicitly
 * caller-requested, permission-held tag (see templateRequired.rule). It never
 * invents a default tag: Meta retired POST_PURCHASE_UPDATE / ACCOUNT_UPDATE /
 * CONFIRMED_EVENT_UPDATE (error 100 since 2026-04-27), so an outside-window
 * send without valid evidence falls through to templateRequired's DENY and is
 * held for merchant recovery.
 *
 * HUMAN_AGENT eligibility is decided from verified event evidence: the clock
 * runs from the customer's last inbound message; beyond 7 days the augment
 * carries `human_agent_window_expired` and no tag.
 *
 * This rule never hard-denies by itself; templateRequired owns the deny.
 */

'use strict';

const consentService = require('../../consent/consent.service');
const { isAllowedMessageTag } = require('./templateRequired.rule');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const HUMAN_AGENT_CLOCK_MS = 7 * WINDOW_MS;

function outsideWindowAugment(message, elapsedMs) {
    const augment = { within_window: false };
    const requested = message?.policy?.messageTag;
    if (requested && isAllowedMessageTag(requested)) {
        // No verified inbound evidence (elapsedMs null) or evidence older than
        // the tag's own clock => not eligible; deny stays in templateRequired.
        if (elapsedMs === null || elapsedMs > HUMAN_AGENT_CLOCK_MS) {
            augment.human_agent_window_expired = true;
        } else {
            augment.message_tag = requested;
        }
    }
    return augment;
}

module.exports = {
    name: 'twentyFourHourWindow',

    async evaluate(message, ctx) {
        const { customer, platform } = ctx;

        const lastInbound = consentService.getLastInboundAt({ customer, platform });
        if (!lastInbound) {
            // No inbound ever -> not within 24h window and no event evidence.
            return { allow: true, reason: 'NO_INBOUND', augment: outsideWindowAugment(message, null) };
        }

        const elapsedMs = Date.now() - lastInbound.getTime();
        if (elapsedMs <= WINDOW_MS) {
            return { allow: true, reason: 'WITHIN_WINDOW', augment: { within_window: true } };
        }

        return { allow: true, reason: 'OUTSIDE_WINDOW', augment: outsideWindowAugment(message, elapsedMs) };
    },
};
