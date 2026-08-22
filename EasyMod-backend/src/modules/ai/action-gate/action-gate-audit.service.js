'use strict';

const { canonicalJson } = require('../contracts/action.contract');

/**
 * Persist one Action Gate decision on the existing audit_logs table. The audit
 * payload deliberately contains hashes and decision metadata, not customer text
 * or credentials.
 * @param {object} record
 * @returns {Promise<object>}
 */
const writeActionGateAudit = async (record) => {
    const { AuditLog } = require('../../entities');
    if (!AuditLog || typeof AuditLog.create !== 'function') {
        throw new Error('Action Gate audit model is unavailable');
    }

    return AuditLog.create({
        user_id: null,
        shop_id: record.shopId,
        action: `ai.action_gate.${String(record.decision).toLowerCase()}`,
        resource_type: 'ai_action',
        resource_id: record.actionId,
        idempotency_key: record.idempotencyKey || null,
        metadata: {
            gateDecisionId: record.gateDecisionId,
            actionType: record.actionType,
            requestedByAgent: record.requestedByAgent,
            domain: record.domain,
            checkResults: record.checkResults,
            reasonCode: record.reasonCode || null,
            evidenceSnapshotHash: record.evidenceSnapshotHash || null,
            proposedPayloadHash: record.payload
                ? require('crypto').createHash('sha256').update(canonicalJson(record.payload), 'utf8').digest('hex')
                : null,
            traceId: record.traceId || null,
            mutationResult: record.mutationResult || null,
            outboundResult: record.outboundResult || null,
        },
    });
};

module.exports = { writeActionGateAudit };
