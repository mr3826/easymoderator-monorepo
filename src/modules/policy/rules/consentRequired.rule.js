/**
 * consentRequired rule
 *
 * Hard-denies outbound when the customer has explicitly opted out of messaging
 * on this platform via the per-channel `customers.messaging_consent` JSONB.
 *
 * Also closes the HIGH-risk gap from the prior architecture: payment confirmations,
 * delivery updates, and invoice notifications all funnel through the policy engine
 * now, so they cannot send to opted-out users.
 *
 * Allows when:
 *   - customer is missing (system message with no customer context — caller's responsibility)
 *   - per-channel consent shows opted_in true (or absent + no opt-out)
 */

'use strict';

const consentService = require('../../consent/consent.service');

module.exports = {
    name: 'consentRequired',

    async evaluate(_message, ctx) {
        const { customer, platform } = ctx;
        if (!customer) return { allow: true, reason: 'NO_CUSTOMER_CONTEXT' };
        if (consentService.hasConsent({ customer, platform })) {
            return { allow: true, reason: 'OK' };
        }
        return { allow: false, reason: 'NO_CONSENT' };
    },
};
