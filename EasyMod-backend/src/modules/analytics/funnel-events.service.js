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
    'first_inbound_message',
    'first_ai_reply_sent',
    'first_order_captured',
    'first_rto_flag',
    'plan_assigned_shuru',
    'usage_threshold_70',
    'usage_threshold_90',
    'usage_threshold_100',
    'plan_upgraded',
    'topup_purchased',
    'renewal_succeeded',
    'renewal_failed',
    'partner_applied',
    'partner_approved',
]);
const PUBLIC_FUNNEL_EVENTS = new Set(['landing_view', 'signup_started']);
const INTERNAL_FUNNEL_EVENTS = new Set([...ALLOWED_FUNNEL_EVENTS].filter(event => !PUBLIC_FUNNEL_EVENTS.has(event)));

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

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value)
        .sort()
        .reduce((result, key) => {
            result[key] = stableValue(value[key]);
            return result;
        }, {});
}

function buildIdempotencyKey({ event, onceKey, userId, shopId, metadata, req, oncePerEntity = false }) {
    if (!onceKey) return null;

    const rawPath = typeof req?.body?.path === 'string'
        ? req.body.path
        : typeof req?.headers?.referer === 'string'
            ? req.headers.referer
            : '';
    const sessionId = typeof req?.body?.sessionId === 'string'
        ? req.body.sessionId.slice(0, 80)
        : null;
    const identity = stableValue({
        version: 2,
        event,
        onceKey,
        userId: userId || null,
        shopId: shopId || null,
        metadata: oncePerEntity ? null : scrubMetadata(metadata),
        path: oncePerEntity ? null : (rawPath.slice(0, 500) || null),
        sessionId: oncePerEntity ? null : sessionId,
    });
    const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    return `funnel:v2:${digest}`;
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
    trustedProducer = false,
    correlationId = null,
    oncePerEntity = false,
}) {
    if (!ALLOWED_FUNNEL_EVENTS.has(event)) {
        const err = new Error(`Unsupported funnel event: ${event}`);
        err.statusCode = 400;
        throw err;
    }
    if (INTERNAL_FUNNEL_EVENTS.has(event) && trustedProducer !== true) {
        const err = new Error('Internal funnel milestones require a trusted server producer.');
        err.statusCode = 403;
        err.code = 'FUNNEL_EVENT_SERVER_ONLY';
        throw err;
    }

    // Bind retries to the event payload and tenant/user context. A reusable
    // header must not suppress a different event submitted by another shop or
    // silently discard a changed payload.
    const idempotencyKey = buildIdempotencyKey({
        event,
        onceKey,
        userId,
        shopId,
        metadata,
        req,
        oncePerEntity,
    });
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
            correlation_id: typeof correlationId === 'string' ? correlationId.slice(0, 128) : null,
            actor_user_id: userId || null,
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
    PUBLIC_FUNNEL_EVENTS,
    INTERNAL_FUNNEL_EVENTS,
    buildIdempotencyKey,
    recordFunnelEvent,
    recordInternalFunnelEvent: options => recordFunnelEvent({ ...options, trustedProducer: true }),
};
