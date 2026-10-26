'use strict';

const crypto = require('crypto');
const {
    MUTATING_ACTION_TYPES,
    isDeterministicIdempotencyKey,
    validateProposedAction,
} = require('../contracts/action.contract');
const {
    AUTHORIZATION_TTL_MS,
    isAuthorizationShapeValid,
    serializeAuthorization,
} = require('../contracts/authorization.contract');
const { isEvidenceSnapshotFresh } = require('../contracts/evidence.contract');
const { writeActionGateAudit } = require('./action-gate-audit.service');
const { isDomainAgentActionEnabled } = require('../../../config/ai-runtime-flags');

const MAX_DOMAIN_HOPS_PER_TURN = 2;

const CHECK_NAMES = Object.freeze([
    'contract_version_supported',
    'tenant_context_complete',
    'tenant_records_match',
    'agent_identity_registered',
    'capability_registry_allows',
    'runtime_kill_switch_enabled',
    'domain_transition_allowed',
    'domain_hop_limit',
    'action_schema_valid',
    'idempotency_key_deterministic',
    'idempotency_not_committed',
    'evidence_snapshot_fresh',
    'material_state_revalidated',
    'customer_confirmation_valid',
    'merchant_mode_allows_mutation',
    'cost_budget_available',
    'authorization_ttl_available',
]);

const CAPABILITIES = Object.freeze({
    CREATE_ORDER: { domain: 'ORDER', agents: ['OrderAgent'], requiresConfirmation: true },
    EDIT_PREORDER_CART: { domain: 'ORDER', agents: ['OrderAgent'], requiresConfirmation: false },
    CANCEL_ORDER_SESSION: { domain: 'ORDER', agents: ['OrderAgent'], requiresConfirmation: false },
    ACCEPT_PAYMENT: { domain: 'COMMERCE_OPS', agents: ['OrderAgent', 'CommerceOpsAgent'], requiresConfirmation: false },
    BOOK_COURIER: { domain: 'COMMERCE_OPS', agents: ['OrderAgent', 'CommerceOpsAgent'], requiresConfirmation: false },
    CREATE_SUPPORT_CASE: { domain: 'SUPPORT', agents: ['SupportAgent', 'OrderAgent'], requiresConfirmation: false },
});

const LEGAL_TRANSITIONS = Object.freeze({
    PRODUCT: new Set(['PRODUCT', 'ORDER', 'KNOWLEDGE', 'SUPPORT']),
    ORDER: new Set(['PRODUCT', 'ORDER', 'KNOWLEDGE', 'COMMERCE_OPS', 'SUPPORT']),
    KNOWLEDGE: new Set(['PRODUCT', 'ORDER', 'KNOWLEDGE', 'COMMERCE_OPS', 'SUPPORT']),
    COMMERCE_OPS: new Set(['ORDER', 'KNOWLEDGE', 'COMMERCE_OPS', 'SUPPORT']),
    SUPPORT: new Set(['SUPPORT']),
});

const getSecret = () => {
    const configured = process.env.AI_ACTION_GATE_SECRET;
    if (configured) return configured;
    if (process.env.NODE_ENV === 'test') return 'test-only-action-gate-secret';
    return null;
};

const sign = (authorization) => {
    const secret = getSecret();
    if (!secret) throw new Error('AI_ACTION_GATE_SECRET is required');
    return crypto.createHmac('sha256', secret).update(serializeAuthorization(authorization), 'utf8').digest('hex');
};

const constantTimeEqual = (left, right) => {
    if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
    return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

const auditDecision = async (record) => {
    try {
        return await writeActionGateAudit(record);
    } catch (error) {
        const auditError = new Error(`Action Gate audit failed: ${error.message}`);
        auditError.code = 'ACTION_GATE_AUDIT_UNAVAILABLE';
        throw auditError;
    }
};

const evaluateChecks = (action, context, now) => {
    const result = Object.fromEntries(CHECK_NAMES.map(name => [name, false]));
    let reasonCode = null;
    const check = (name, passed) => {
        result[name] = Boolean(passed);
        if (!result[name] && !reasonCode) reasonCode = name;
    };
    const capability = CAPABILITIES[action?.actionType];
    const tenant = context.tenant || {};
    const expiresAt = Date.parse(action?.expiresAt || '');

    check('contract_version_supported', action?.contractVersion === '1.0');
    check('tenant_context_complete', Boolean(
        action?.shopId && action?.conversationId && tenant.shopId && tenant.conversationId
            && tenant.customerId && context.traceId
    ));
    check('tenant_records_match', context.tenantRecordsMatch === true
        && tenant.shopId === action?.shopId
        && tenant.conversationId === action?.conversationId);
    check('agent_identity_registered', Boolean(action?.requestedByAgent));
    check('capability_registry_allows', Boolean(
        capability
            && capability.agents.includes(action?.requestedByAgent)
            && MUTATING_ACTION_TYPES.includes(action?.actionType)
    ));
    check('runtime_kill_switch_enabled', isDomainAgentActionEnabled(action?.actionType));
    const currentDomain = context.currentDomain || action?.domain;
    check('domain_transition_allowed', Boolean(
        capability && capability.domain === action?.domain
            && LEGAL_TRANSITIONS[currentDomain]?.has(action?.domain)
    ));
    check('domain_hop_limit', Number.isInteger(context.domainHops) && context.domainHops <= MAX_DOMAIN_HOPS_PER_TURN);
    check('action_schema_valid', validateProposedAction(action));
    check('idempotency_key_deterministic', isDeterministicIdempotencyKey(action?.idempotencyKey)
        && (!context.expectedIdempotencyKey || context.expectedIdempotencyKey === action.idempotencyKey));
    check('idempotency_not_committed', context.idempotencyCommitted !== true);
    check('evidence_snapshot_fresh', Boolean(
        context.evidenceSnapshot
            && context.evidenceSnapshot.snapshotHash === action?.evidenceSnapshotHash
            && isEvidenceSnapshotFresh(context.evidenceSnapshot, now)
    ));
    check('material_state_revalidated', context.materialStateRevalidated === true);
    check('customer_confirmation_valid', !capability?.requiresConfirmation || context.customerConfirmationValid === true);
    check('merchant_mode_allows_mutation', context.merchantModeAllowsMutation === true);
    check('cost_budget_available', context.costBudgetAvailable === true);
    check('authorization_ttl_available', Boolean(getSecret())
        && Number.isFinite(expiresAt)
        && expiresAt > now.getTime()
        && expiresAt - now.getTime() <= AUTHORIZATION_TTL_MS);

    return { checkResults: result, reasonCode };
};

/**
 * Authorize one typed mutating action. All checks run before a token is minted;
 * any exception fails closed and no authorization is returned.
 * @param {import('../contracts/action.contract').ProposedAction} action
 * @param {object} context
 * @returns {Promise<{authorized:boolean, authorization?:object, gateDecisionId:string, checkResults:object, reasonCode:string|null}>}
 */
const authorize = async (action, context = {}) => {
    const now = new Date();
    const gateDecisionId = crypto.randomUUID();
    const { checkResults, reasonCode } = evaluateChecks(action, context, now);
    const passed = !reasonCode;
    const issuedAt = passed ? now.toISOString() : null;
    const expiresAt = passed ? new Date(now.getTime() + AUTHORIZATION_TTL_MS).toISOString() : null;
    const baseRecord = {
        actionId: action?.actionId || gateDecisionId,
        actionType: action?.actionType || null,
        requestedByAgent: action?.requestedByAgent || null,
        domain: action?.domain || null,
        shopId: action?.shopId || context.tenant?.shopId || null,
        idempotencyKey: action?.idempotencyKey || null,
        evidenceSnapshotHash: action?.evidenceSnapshotHash || null,
        payload: action?.payload || null,
        traceId: context.traceId || null,
        taskId: context.taskId || null,
        conversationId: action?.conversationId || context.conversationId || context.tenant?.conversationId || null,
        gateDecisionId,
        issuedAt,
        expiresAt,
        decision: passed ? 'AUTHORIZED' : 'DENIED',
        checkResults,
        reasonCode,
        mutationResult: null,
        outboundResult: null,
    };

    await auditDecision(baseRecord);
    if (!passed) return { authorized: false, gateDecisionId, checkResults, reasonCode };

    const authorization = {
        contractVersion: '1.0',
        authorizationId: crypto.randomUUID(),
        actionId: action.actionId,
        actionType: action.actionType,
        shopId: action.shopId,
        actorAgent: action.requestedByAgent,
        taskId: context.taskId || null,
        conversationId: action.conversationId || context.conversationId || context.tenant?.conversationId || null,
        traceId: context.traceId || null,
        idempotencyKey: action.idempotencyKey,
        evidenceSnapshotHash: action.evidenceSnapshotHash,
        issuedAt,
        expiresAt,
        gateDecisionId,
    };
    authorization.signature = sign(authorization);
    return { authorized: true, authorization, gateDecisionId, checkResults, reasonCode: null };
};

const sanitizeActionOutcome = (value = {}) => ({
    success: value.success === true,
    state: typeof value.state === 'string' ? value.state.slice(0, 48) : 'unknown',
    code: typeof value.code === 'string' ? value.code.slice(0, 64) : null,
    resourceId: typeof value.resourceId === 'string' ? value.resourceId : null,
});

const recordActionGateOutcome = async ({ authorization, mutationResult, outboundResult }) => {
    if (!isAuthorizationShapeValid(authorization)) {
        return { recorded: false, reasonCode: 'authorization_invalid' };
    }
    // IC-V1 review F7: only a mint that this gate actually signed may append
    // a RESULT_RECORDED row. Shape validity alone would let any caller that
    // can reach the service fabricate outcome audits. TTL is deliberately not
    // enforced here — the mutation may legitimately commit just after expiry;
    // the mint-time and service-boundary signature checks govern authority.
    let signatureValid = false;
    try {
        signatureValid = constantTimeEqual(authorization.signature, sign(authorization));
    } catch {
        signatureValid = false;
    }
    if (!signatureValid) return { recorded: false, reasonCode: 'authorization_signature_invalid' };
    const capability = CAPABILITIES[authorization.actionType];
    if (!capability) return { recorded: false, reasonCode: 'action_capability_unknown' };
    const idempotencyKey = crypto.createHash('sha256')
        .update(`${authorization.gateDecisionId}:result`, 'utf8')
        .digest('hex');

    await auditDecision({
        actionId: authorization.actionId || authorization.authorizationId,
        actionType: authorization.actionType,
        requestedByAgent: authorization.actorAgent,
        domain: capability.domain,
        shopId: authorization.shopId,
        idempotencyKey,
        evidenceSnapshotHash: authorization.evidenceSnapshotHash,
        payload: { outcome: true },
        traceId: authorization.traceId || null,
        taskId: authorization.taskId || null,
        conversationId: authorization.conversationId || null,
        gateDecisionId: authorization.gateDecisionId,
        issuedAt: authorization.issuedAt,
        expiresAt: authorization.expiresAt,
        decision: 'RESULT_RECORDED',
        checkResults: {},
        reasonCode: mutationResult?.success === false ? mutationResult.code || 'mutation_failed' : null,
        mutationResult: sanitizeActionOutcome(mutationResult),
        outboundResult: sanitizeActionOutcome(outboundResult),
    });
    return { recorded: true };
};

/**
 * Verify a previously minted authorization at the mutation service boundary.
 * @param {object} authorization
 * @param {object} expected
 * @returns {boolean}
 */
const verifyAuthorization = (authorization, expected = {}) => {
    if (!isAuthorizationShapeValid(authorization)) return false;
    const expiresAt = Date.parse(authorization.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
    if (!isDomainAgentActionEnabled(authorization.actionType)) return false;
    if (expected.actionType && authorization.actionType !== expected.actionType) return false;
    if (expected.shopId && authorization.shopId !== expected.shopId) return false;
    if (expected.idempotencyKey && authorization.idempotencyKey !== expected.idempotencyKey) return false;
    if (expected.evidenceSnapshotHash && authorization.evidenceSnapshotHash !== expected.evidenceSnapshotHash) return false;
    try {
        return constantTimeEqual(authorization.signature, sign(authorization));
    } catch {
        return false;
    }
};

module.exports = {
    ACTION_GATE_CHECK_NAMES: CHECK_NAMES,
    ACTION_GATE_CAPABILITIES: CAPABILITIES,
    LEGAL_TRANSITIONS,
    MAX_DOMAIN_HOPS_PER_TURN,
    authorize,
    recordActionGateOutcome,
    evaluateChecks,
    verifyAuthorization,
    _private: { getSecret },
};
