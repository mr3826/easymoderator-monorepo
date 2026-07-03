'use strict';

const AuditLog = require('../audit/audit-log.entity');

const DEFAULT_OWNER = process.env.FOUNDER_CRM_OWNER || 'founder';

function compactLeadPayload(payload) {
    const safe = {};
    for (const [key, value] of Object.entries(payload || {})) {
        if (value == null || value === '') continue;
        if (typeof value === 'string') safe[key] = value.slice(0, 300);
        else if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
    }
    return safe;
}

async function recordCrmLead({
    source,
    shopId = null,
    userId = null,
    resourceId = null,
    leadSource = source,
    niche = null,
    facebookPage = null,
    estimatedOrderVolume = null,
    status = 'new',
    nextAction = 'Day 1 founder follow-up',
    owner = DEFAULT_OWNER,
    objection = null,
    activationStage = 'lead_captured',
    metadata = {},
}) {
    if (!source) return null;

    const id = String(resourceId || `${source}:${shopId || userId || Date.now()}`);
    const idempotencyKey = `crm:lead:${source}:${id}`.slice(0, 255);
    const existing = await AuditLog.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) return existing;

    return AuditLog.create({
        user_id: userId,
        shop_id: shopId,
        action: 'crm:lead_created',
        resource_type: 'crm_lead',
        resource_id: id,
        metadata: compactLeadPayload({
            lead_source: leadSource,
            niche,
            facebook_page: facebookPage,
            estimated_order_volume: estimatedOrderVolume,
            status,
            next_action: nextAction,
            owner,
            objection,
            activation_stage: activationStage,
            ...metadata,
        }),
        idempotency_key: idempotencyKey,
    });
}

module.exports = { recordCrmLead };
