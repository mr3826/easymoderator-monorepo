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
 * Missing customer context is only compatible with non-Meta callers. Customer
 * sends require a resolved customer; legacy transactional notifications may
 * proceed when the per-channel record is absent, but explicit opt-outs remain
 * blocking in the companion rule.
 */

'use strict';

const consentService = require('../../consent/consent.service');
const META_PLATFORMS = new Set(['facebook', 'messenger', 'instagram']);

function consentPlatform(platform) {
    return platform === 'messenger' ? 'facebook' : platform;
}

function hasMissingLegacyConsentRecord(customer, platform) {
    const record = customer?.messaging_consent;
    if (record === undefined) return true;
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    return !Object.prototype.hasOwnProperty.call(record, consentPlatform(platform));
}

function isTransactionalLegacySend(message, ctx, platform) {
    return ctx.messageType === 'transactional'
        && hasMissingLegacyConsentRecord(ctx.customer, platform);
}

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

        // Existing transactional records may predate the JSON consent field.
        // Preserve delivery/payment/invoice notifications while still allowing
        // the other consent rule to block an explicit opt-out.
        if (isTransactionalLegacySend(_message, ctx, pf)) {
            return { allow: true, reason: 'TRANSACTIONAL_LEGACY_CONSENT' };
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
