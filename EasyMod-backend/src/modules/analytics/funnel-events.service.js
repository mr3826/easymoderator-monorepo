'use strict';

const crypto = require('crypto');
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

function deterministicAuditId(idempotencyKey) {
    const bytes = Buffer.from(
        crypto.createHash('sha256').update(`easymod:funnel:${idempotencyKey}`).digest().subarray(0, 16),
    );
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

    const rawPath = typeof req?.body?.path === 'string'
        ? req.body.path
        : typeof req?.headers?.referer === 'string'
            ? req.headers.referer
            : '';
    const auditValues = {
        user_id: userId,
        shop_id: shopId,
        action: `funnel:${event}`,
        resource_type: 'funnel_event',
        resource_id: event,
        metadata: {
            ...scrubMetadata(metadata),
            path: rawPath.slice(0, 500) || null,
            session_id: typeof req?.body?.sessionId === 'string' ? req.body.sessionId.slice(0, 80) : null,
        },
        ip_address: typeof req?.ip === 'string' ? req.ip.slice(0, 45) : null,
        user_agent: req?.headers?.['user-agent'] || null,
        idempotency_key: idempotencyKey,
    };

    if (!idempotencyKey) {
        return AuditLog.create(auditValues);
    }

    // The audit-log idempotency column is indexed but not unique. A stable UUID
    // lets the database primary key resolve concurrent retries atomically while
    // the lookup above remains compatible with historical random-ID rows.
    const id = deterministicAuditId(idempotencyKey);
    const [row] = await AuditLog.findOrCreate({
        where: { id },
        defaults: { id, ...auditValues },
    });
    return row;
}

module.exports = {
    ALLOWED_FUNNEL_EVENTS,
    recordFunnelEvent,
};
