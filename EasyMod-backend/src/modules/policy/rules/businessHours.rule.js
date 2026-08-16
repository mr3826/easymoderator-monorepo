/**
 * businessHours rule
 *
 * If the channel has business_hours configured and the current time is outside
 * them, and the channel is in AI_ACTIVE mode, the rule does NOT deny but emits
 * a SUGGEST_ONLY reason so the worker downgrades from auto-send to suggestion.
 *
 * Outside business hours but the message is a customer-triggered reply
 * (within_window=true) is allowed — we don't want to break replies to active
 * conversations just because the shop is "closed".
 *
 * business_hours shape (in MetaChannelSettings):
 *   {
 *     timezone: 'Asia/Dhaka',
 *     mon: { open: '09:00', close: '21:00' },
 *     ... per day
 *   }
 *
 * If business_hours is null/missing, rule is a no-op.
 */

'use strict';

function parseHHMM(s) {
    const [h, m] = String(s).split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function dayKey(date) {
    return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
}

function isInsideHours(hours, now = new Date()) {
    if (!hours || typeof hours !== 'object') return true;
    const slot = hours[dayKey(now)];
    if (!slot) return false;
    const open = parseHHMM(slot.open);
    const close = parseHHMM(slot.close);
    if (open == null || close == null) return true;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return nowMin >= open && nowMin < close;
}

module.exports = {
    name: 'businessHours',

    async evaluate(_message, ctx) {
        const settings = ctx.settings || {};
        const automationMode = settings.automation_mode || 'DRAFT';
        const businessHours = settings.business_hours;
        if (!businessHours) return { allow: true, reason: 'NO_HOURS_CONFIG' };

        if (isInsideHours(businessHours)) {
            return { allow: true, reason: 'INSIDE_HOURS' };
        }
        if (automationMode === 'AI_ACTIVE') {
            // Downgrade — allow the engine to flag the worker to store-only.
            return { allow: false, reason: 'SUGGEST_ONLY' };
        }
        return { allow: true, reason: 'OUTSIDE_HOURS_NON_AI' };
    },
};

module.exports.isInsideHours = isInsideHours;
