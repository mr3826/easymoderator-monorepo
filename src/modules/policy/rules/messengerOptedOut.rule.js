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

module.exports = {
    name: 'messengerOptedOut',

    async evaluate(_message, ctx) {
        const { customer, platform } = ctx;
        if (!customer) return { allow: true, reason: 'NO_CUSTOMER_CONTEXT' };

        // Check per-channel consent (Phase 5 single source of truth)
        const pf = platform || _message?.platform;
        if (pf) {
            const consent = customer.messaging_consent?.[pf];
            if (consent?.opted_out_at) {
                return { allow: false, reason: 'OPTED_OUT' };
            }
        }

        return { allow: true, reason: 'OK' };
    },
};
