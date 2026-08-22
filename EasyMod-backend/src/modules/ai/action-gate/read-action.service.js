'use strict';

const crypto = require('crypto');
const {
    MUTATING_ACTION_TYPES,
    READ_ONLY_ACTION_TYPES,
    canonicalJson,
    createProposedAction,
    deriveIdempotencyKey,
    validateProposedAction,
} = require('../contracts/action.contract');
const { isEvidenceSnapshotFresh } = require('../contracts/evidence.contract');
const { writeActionGateAudit } = require('./action-gate-audit.service');

const READ_DOMAINS = Object.freeze({
    READ_PRODUCT: 'PRODUCT',
    READ_FAQ: 'KNOWLEDGE',
    READ_DELIVERY_POLICY: 'KNOWLEDGE',
    READ_PAYMENT_POLICY: 'KNOWLEDGE',
    READ_ORDER_STATUS: 'ORDER',
    READ_CUSTOMER_CONTEXT: 'SUPPORT',
});

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

const failure = (reasonCode) => ({ recorded: false, reasonCode });

const audit = async ({ action, actionType, tenant, traceId, reasonCode, decision = 'DENIED', payload }) => {
    try {
        await writeActionGateAudit({
            actionId: action?.actionId || crypto.randomUUID(),
            actionType: action?.actionType || actionType || null,
            requestedByAgent: action?.requestedByAgent || 'ReadAgent',
            domain: action?.domain || null,
            shopId: action?.shopId || tenant?.shopId || null,
            conversationId: action?.conversationId || tenant?.conversationId || null,
            idempotencyKey: action?.idempotencyKey || null,
            evidenceSnapshotHash: action?.evidenceSnapshotHash || null,
            payload: action?.payload || payload || null,
            traceId: traceId || null,
            gateDecisionId: crypto.randomUUID(),
            decision,
            checkResults: {
                readOnlyAction: READ_ONLY_ACTION_TYPES.includes(actionType),
                tenantBound: Boolean(tenant?.shopId && tenant?.conversationId),
                evidenceFresh: Boolean(action?.evidenceSnapshotHash),
            },
            reasonCode: reasonCode || null,
            mutationResult: null,
            outboundResult: null,
        });
        return true;
    } catch (_) {
        return false;
    }
};

const actionFingerprint = ({ actionType, tenant, traceId, evidenceSnapshot, payload }) => deriveIdempotencyKey([
    'read',
    actionType,
    tenant.shopId,
    tenant.conversationId,
    traceId,
    evidenceSnapshot.snapshotHash,
    sha256(canonicalJson(payload || {})),
]);

/**
 * Record a tenant-bound read without minting mutation authorization. The
 * deterministic key is a request fingerprint: a read has no committed state
 * whose duplicate can collide with an idempotency key.
 */
const recordReadAction = async ({
    actionType,
    tenant,
    traceId,
    evidenceSnapshot,
    payload = {},
    requestedByAgent = 'ReadAgent',
} = {}) => {
    const tenantContext = tenant || {};
    const evidenceShopId = evidenceSnapshot?.shopId || evidenceSnapshot?.shop_id;
    const evidenceCustomerId = evidenceSnapshot?.customerId || evidenceSnapshot?.customer_id;
    const evidenceConversationId = evidenceSnapshot?.conversationId || evidenceSnapshot?.conversation_id;

    if (MUTATING_ACTION_TYPES.includes(actionType)) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'mutating_action_refused', payload });
        return failure(audited ? 'mutating_action_refused' : 'audit_unavailable');
    }
    if (!READ_ONLY_ACTION_TYPES.includes(actionType)) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'read_action_type_invalid', payload });
        return failure(audited ? 'read_action_type_invalid' : 'audit_unavailable');
    }
    if (actionType === 'READ_ORDER_STATUS' && !tenantContext.customerId) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'customer_identity_unbound', payload });
        return failure(audited ? 'customer_identity_unbound' : 'audit_unavailable');
    }
    if (!tenantContext.shopId || !tenantContext.conversationId || !traceId) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'tenant_context_incomplete', payload });
        return failure(audited ? 'tenant_context_incomplete' : 'audit_unavailable');
    }
    if (!tenantContext.customerId) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'tenant_context_incomplete', payload });
        return failure(audited ? 'tenant_context_incomplete' : 'audit_unavailable');
    }
    if (!evidenceShopId || evidenceShopId !== tenantContext.shopId) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'tenant_scope_mismatch', payload });
        return failure(audited ? 'tenant_scope_mismatch' : 'audit_unavailable');
    }
    if ((payload?.shopId && payload.shopId !== tenantContext.shopId)
        || (payload?.shop_id && payload.shop_id !== tenantContext.shopId)
        || (payload?.customerId && payload.customerId !== tenantContext.customerId)
        || (payload?.customer_id && payload.customer_id !== tenantContext.customerId)
        || (payload?.conversationId && payload.conversationId !== tenantContext.conversationId)
        || (payload?.conversation_id && payload.conversation_id !== tenantContext.conversationId)
        || (evidenceCustomerId && evidenceCustomerId !== tenantContext.customerId)
        || (evidenceConversationId && evidenceConversationId !== tenantContext.conversationId)) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'tenant_scope_mismatch', payload });
        return failure(audited ? 'tenant_scope_mismatch' : 'audit_unavailable');
    }
    if (!evidenceSnapshot || !isEvidenceSnapshotFresh(evidenceSnapshot)) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'evidence_snapshot_stale', payload });
        return failure(audited ? 'evidence_snapshot_stale' : 'audit_unavailable');
    }

    let action;
    try {
        action = createProposedAction({
            requestedByAgent,
            actionType,
            domain: payload?.requiresLiveLookup ? 'COMMERCE_OPS' : READ_DOMAINS[actionType],
            shopId: tenantContext.shopId,
            conversationId: tenantContext.conversationId,
            idempotencyKey: actionFingerprint({ actionType, tenant: tenantContext, traceId, evidenceSnapshot, payload }),
            evidenceSnapshotHash: evidenceSnapshot.snapshotHash,
            payload,
        });
    } catch (_) {
        const audited = await audit({ actionType, tenant: tenantContext, traceId, reasonCode: 'read_action_contract_invalid', payload });
        return failure(audited ? 'read_action_contract_invalid' : 'audit_unavailable');
    }

    if (!validateProposedAction(action) || action.mutates) {
        const audited = await audit({ action, actionType, tenant: tenantContext, traceId, reasonCode: 'read_action_contract_invalid', payload });
        return failure(audited ? 'read_action_contract_invalid' : 'audit_unavailable');
    }

    const recorded = await audit({ action, actionType, tenant: tenantContext, traceId, reasonCode: null, decision: 'RECORDED', payload });
    return recorded ? { recorded: true, reasonCode: null } : failure('audit_unavailable');
};

module.exports = { READ_DOMAINS, recordReadAction };
