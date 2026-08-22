'use strict';

const crypto = require('crypto');
const { READ_ONLY_ACTION_TYPES } = require('../contracts/action.contract');
const { writeActionGateAudit } = require('./action-gate-audit.service');
const { READ_DOMAINS, evaluateReadAction } = require('./read-action-evaluator');

const failure = reasonCode => ({ recorded: false, reasonCode });

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

/**
 * Record a tenant-bound read without minting mutation authorization. The
 * deterministic key is a request fingerprint: a read has no committed state
 * whose duplicate can collide with an idempotency key.
 */
const recordReadAction = async (params = {}) => {
    const {
        actionType,
        tenant,
        traceId,
        payload = {},
    } = params;
    const result = evaluateReadAction(params);
    const audited = await audit({
        action: result.action,
        actionType,
        tenant: tenant || {},
        traceId,
        reasonCode: result.reasonCode,
        decision: result.recorded ? 'RECORDED' : 'DENIED',
        payload,
    });
    if (!audited) return failure('audit_unavailable');
    return result.recorded
        ? { recorded: true, reasonCode: null }
        : failure(result.reasonCode);
};

module.exports = { READ_DOMAINS, recordReadAction };
