/**
 * messengerOptedOut rule
 *
 * Phase 5: checks the per-channel messaging_consent JSONB (single source of truth).
 * The legacy per-shop boolean column was dropped in the Phase 5 migration.
 *
 * Closes the HIGH-risk Meta-side opt-out gap: every outbound send now
 * funnels through the policy engine and this rule blocks opted-out users.
 */

'use strict';

const META_PLATFORMS = new Set(['facebook', 'messenger', 'instagram']);

module.exports = {
    name: 'messengerOptedOut',

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

        // Check per-channel consent (Phase 5 single source of truth).
        if (!isMeta) return { allow: true, reason: 'OK' };

        const consentPlatform = pf === 'messenger' ? 'facebook' : pf;
        const consent = customer.messaging_consent?.[consentPlatform];
        if (!consent || typeof consent !== 'object' || Array.isArray(consent)) {
            return { allow: false, reason: 'CONSENT_STATE_UNAVAILABLE', retryable: true };
        }
        if (consent.opted_out_at) return { allow: false, reason: 'OPTED_OUT' };
        if (consent.opted_in !== true) return { allow: false, reason: 'NO_CONSENT' };
        return { allow: true, reason: 'OK' };
    },
};
