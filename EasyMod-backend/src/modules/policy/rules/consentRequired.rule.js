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
 * Missing customer context is only compatible with non-Meta callers. Meta
 * customer sends require a resolved customer and explicit per-channel opt-in.
 */

'use strict';

const consentService = require('../../consent/consent.service');
const META_PLATFORMS = new Set(['facebook', 'messenger', 'instagram']);

module.exports = {
    name: 'consentRequired',

    async evaluate(_message, ctx = {}) {
        const { customer, platform } = ctx;
        const pf = platform || _message?.platform;
        const isMeta = META_PLATFORMS.has(pf);

        if (!pf) {
            return { allow: false, reason: 'CONSENT_CONTEXT_UNAVAILABLE', retryable: true };
        }

        if (!customer) {
            return isMeta
                ? { allow: false, reason: 'CUSTOMER_CONTEXT_UNAVAILABLE', retryable: true }
                : { allow: true, reason: 'NO_CUSTOMER_CONTEXT' };
        }

        try {
            if (await consentService.hasConsent({ customer, platform: pf }) === true) {
                return { allow: true, reason: 'OK' };
            }
        } catch (_) {
            return { allow: false, reason: 'CONSENT_STATE_UNAVAILABLE', retryable: true };
        }

        return { allow: false, reason: 'NO_CONSENT' };
    },
};
