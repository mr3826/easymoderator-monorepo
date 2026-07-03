'use strict';

const AuditLog = require('../audit/audit-log.entity');

const ALLOWED_FUNNEL_EVENTS = new Set([
    'landing_view',
    'signup_started',
    'signup_completed',
    'facebook_connect_started',
    'facebook_connect_succeeded',
    'shop_profile_completed',
    'first_product_added',
    'assistant_test_passed',
    'first_inbound_message',
    'first_ai_reply_sent',
    'first_order_captured',
    'first_rto_flag',
    'trial_day_7_active',
]);

function scrubMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
    const safe = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (value == null) continue;
        if (['password', 'token', 'accessToken', 'refreshToken', 'phone', 'email', 'message'].includes(key)) continue;
        if (typeof value === 'string') safe[key] = value.slice(0, 200);
        else if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
    }
    return safe;
}

async function recordFunnelEvent({
    event,
    userId = null,
    shopId = null,
    metadata = {},
    req = null,
    onceKey = null,
}) {
    if (!ALLOWED_FUNNEL_EVENTS.has(event)) {
        const err = new Error(`Unsupported funnel event: ${event}`);
        err.statusCode = 400;
        throw err;
    }

    const idempotencyKey = onceKey ? `funnel:${event}:${onceKey}`.slice(0, 255) : null;
    if (idempotencyKey) {
        const existing = await AuditLog.findOne({ where: { idempotency_key: idempotencyKey } });
        if (existing) return existing;
    }

    return AuditLog.create({
        user_id: userId,
        shop_id: shopId,
        action: `funnel:${event}`,
        resource_type: 'funnel_event',
        resource_id: event,
        metadata: {
            ...scrubMetadata(metadata),
            path: req?.body?.path || req?.headers?.referer || null,
            session_id: typeof req?.body?.sessionId === 'string' ? req.body.sessionId.slice(0, 80) : null,
        },
        ip_address: req?.ip || null,
        user_agent: req?.headers?.['user-agent'] || null,
        idempotency_key: idempotencyKey,
    });
}

module.exports = {
    ALLOWED_FUNNEL_EVENTS,
    recordFunnelEvent,
};
