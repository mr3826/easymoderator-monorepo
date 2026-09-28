'use strict';

/**
 * Advisory "can the merchant reply right now?" indicator for Customer 360 and
 * Sales Opportunities.
 *
 * Read-only. It never sends and never authorizes a send: every outbound
 * message still goes through the Inbox manual-send path and the central
 * policy engine (policy/policy.engine.js). This only tells the merchant, in
 * advance, what that engine will decide about the 24-hour window and opt-out.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

const PLATFORM_BY_CHANNEL = Object.freeze({
    messenger: 'facebook',
    facebook: 'facebook',
    instagram: 'instagram',
});

function contactability(customer, now = new Date()) {
    const platform = PLATFORM_BY_CHANNEL[customer?.channel_type] || null;
    if (!platform) {
        return { platform: null, window_open: false, window_closes_at: null, reason: 'NOT_A_MESSAGING_CHANNEL' };
    }
    const consent = customer?.messaging_consent?.[platform] || {};
    if (consent.opted_out_at) {
        return { platform, window_open: false, window_closes_at: null, reason: 'OPTED_OUT' };
    }
    const lastInbound = consent.last_inbound_at ? new Date(consent.last_inbound_at) : null;
    if (!lastInbound || !Number.isFinite(lastInbound.getTime())) {
        return { platform, window_open: false, window_closes_at: null, reason: 'NO_INBOUND_MESSAGE' };
    }
    const closesAt = new Date(lastInbound.getTime() + WINDOW_MS);
    const open = closesAt.getTime() > now.getTime();
    return {
        platform,
        window_open: open,
        window_closes_at: closesAt.toISOString(),
        reason: open ? 'WITHIN_24H_WINDOW' : 'OUTSIDE_24H_WINDOW',
    };
}

const isOptedOut = (customer) => contactability(customer).reason === 'OPTED_OUT';

module.exports = { contactability, isOptedOut, WINDOW_MS };
