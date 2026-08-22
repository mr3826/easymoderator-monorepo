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

const actionFingerprint = ({ actionType, tenant, traceId, evidenceSnapshot, payload }) => deriveIdempotencyKey([
    'read',
    actionType,
    tenant.shopId,
    tenant.conversationId,
    traceId,
    evidenceSnapshot.snapshotHash,
    sha256(canonicalJson(payload || {})),
]);

/** Evaluate a read without persisting an audit decision. */
const evaluateReadAction = ({
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

    if (MUTATING_ACTION_TYPES.includes(actionType)) return failure('mutating_action_refused');
    if (!READ_ONLY_ACTION_TYPES.includes(actionType)) return failure('read_action_type_invalid');
    if (actionType === 'READ_ORDER_STATUS' && !tenantContext.customerId) {
        return failure('customer_identity_unbound');
    }
    if (!tenantContext.shopId || !tenantContext.conversationId || !traceId) {
        return failure('tenant_context_incomplete');
    }
    if (!tenantContext.customerId) return failure('tenant_context_incomplete');
    if (!evidenceShopId || evidenceShopId !== tenantContext.shopId) {
        return failure('tenant_scope_mismatch');
    }
    if ((payload?.shopId && payload.shopId !== tenantContext.shopId)
        || (payload?.shop_id && payload.shop_id !== tenantContext.shopId)
        || (payload?.customerId && payload.customerId !== tenantContext.customerId)
        || (payload?.customer_id && payload.customer_id !== tenantContext.customerId)
        || (payload?.conversationId && payload.conversationId !== tenantContext.conversationId)
        || (payload?.conversation_id && payload.conversation_id !== tenantContext.conversationId)
        || (evidenceCustomerId && evidenceCustomerId !== tenantContext.customerId)
        || (evidenceConversationId && evidenceConversationId !== tenantContext.conversationId)) {
        return failure('tenant_scope_mismatch');
    }
    if (!evidenceSnapshot || !isEvidenceSnapshotFresh(evidenceSnapshot)) {
        return failure('evidence_snapshot_stale');
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
        return failure('read_action_contract_invalid');
    }

    if (!validateProposedAction(action) || action.mutates) return failure('read_action_contract_invalid');
    return { recorded: true, reasonCode: null, action };
};

module.exports = { READ_DOMAINS, evaluateReadAction };
