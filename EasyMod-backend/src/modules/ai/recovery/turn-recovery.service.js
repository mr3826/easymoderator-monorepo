'use strict';

const { sequelize } = require('../../../utils/database/database-setup');
const ConversationTurn = require('../../conversation/conversation-turn.entity');
const { Conversation } = require('../../conversation/conversation.entity');
const { escalateToHuman } = require('../../conversation/human-handoff.service');

const CUSTOMER_STATES = Object.freeze([
    'RECEIVED',
    'CONTEXT_BUILDING',
    'EVIDENCE_RETRIEVING',
    'AGENT_RUNNING',
    'AWAITING_CONFIRMATION',
    'ACTION_GATE',
    'MUTATING',
    'VERIFYING_RESPONSE',
    'SAFE_FALLBACK',
    'HUMAN_REQUIRED',
    'SENT',
    'RETRY_PENDING',
    'INDETERMINATE',
    'DEAD_LETTERED',
]);

const RETRY_STATES = Object.freeze([
    'NOT_STARTED',
    'GATE_DENIED',
    'MUTATION_REJECTED',
    'MUTATION_COMMITTED',
    'MUTATION_INDETERMINATE',
    'PROVIDER_SEND_FAILED',
    'HOLDING_SEND_FAILED',
]);

const HOLDING_SUPPRESSED_STATES = new Set(['AWAITING_CONFIRMATION', 'SENT', 'DEAD_LETTERED']);
const TERMINAL_STATES = new Set(['SENT', 'DEAD_LETTERED']);
const requiredText = (value, field) => {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
    return value;
};

const now = () => new Date();
const transitionEntry = (from, state, at = now(), metadata = {}) => ({
    from: from || null,
    state,
    at: new Date(at).toISOString(),
    ...metadata,
});

const turnDefaults = (input, startedAt = now()) => ({
    turn_id: requiredText(input.turnId, 'turnId'),
    trace_id: requiredText(input.traceId, 'traceId'),
    shop_id: requiredText(input.shopId, 'shopId'),
    conversation_id: requiredText(input.conversationId, 'conversationId'),
    intent_id: input.intentId || null,
    state: input.state || 'RECEIVED',
    retry_state: input.retryState || 'NOT_STARTED',
    recovery_kind: input.recoveryKind || null,
    state_transitions: [transitionEntry(null, input.state || 'RECEIVED', startedAt)],
    turn_started_at: startedAt,
    retry_count: Number.isInteger(input.retryCount) ? input.retryCount : 0,
    idempotency_key: input.idempotencyKey || null,
    mutation_status: input.mutationStatus || null,
    outbound_status: input.outboundStatus || null,
    provider_reference: input.providerReference || null,
    recovery_reason: input.recoveryReason || null,
    final_state: input.finalState || null,
});

const findTurn = async (turnId, conversationId) => ConversationTurn.findOne({
    where: conversationId ? { turn_id: turnId, conversation_id: conversationId } : { turn_id: turnId },
});

/** Idempotent first durable write. A replay never replaces turn_started_at. */
const startTurn = async (input = {}) => {
    const defaults = turnDefaults(input);
    if (!CUSTOMER_STATES.includes(defaults.state)) throw new TypeError(`Unsupported customer state: ${defaults.state}`);
    if (!RETRY_STATES.includes(defaults.retry_state)) throw new TypeError(`Unsupported retry state: ${defaults.retry_state}`);

    if (typeof ConversationTurn.findOrCreate === 'function') {
        const [turn, created] = await ConversationTurn.findOrCreate({
            where: { turn_id: defaults.turn_id, conversation_id: defaults.conversation_id },
            defaults,
        });
        return { turn, created };
    }

    const existing = await findTurn(defaults.turn_id, defaults.conversation_id);
    if (existing) return { turn: existing, created: false };
    const turn = await ConversationTurn.create(defaults);
    return { turn, created: true };
};

const transition = async (input, nextState, metadata = {}) => {
    const turnId = typeof input === 'string' ? input : input?.turnId || input?.turn_id;
    const conversationId = typeof input === 'object' ? input.conversationId || input.conversation_id : undefined;
    if (!CUSTOMER_STATES.includes(nextState)) throw new TypeError(`Unsupported customer state: ${nextState}`);
    const turn = typeof input === 'object' && input?.update ? input : await findTurn(requiredText(turnId, 'turnId'), conversationId);
    if (!turn) throw new Error(`Conversation turn not found: ${turnId}`);
    const transitions = Array.isArray(turn.state_transitions) ? turn.state_transitions : [];
    const {
        at,
        transaction,
        retryState,
        recoveryKind,
        recoveryReason,
        firstHoldingAt,
        hardTimeoutAt,
        outboundStatus,
        ...transitionMetadata
    } = metadata;
    const update = {
        state: nextState,
        state_transitions: [...transitions, transitionEntry(turn.state, nextState, at || now(), transitionMetadata)],
        ...(retryState ? { retry_state: retryState } : {}),
        ...(recoveryKind ? { recovery_kind: recoveryKind } : {}),
        ...(recoveryReason ? { recovery_reason: recoveryReason } : {}),
        ...(firstHoldingAt ? { first_holding_at: firstHoldingAt } : {}),
        ...(hardTimeoutAt ? { hard_timeout_at: hardTimeoutAt } : {}),
        ...(outboundStatus ? { outbound_status: outboundStatus } : {}),
        ...(TERMINAL_STATES.has(nextState) ? { final_state: nextState } : {}),
    };
    await turn.update(update, transaction ? { transaction } : undefined);
    return turn;
};

const createOrUpdateHumanTurn = async (input, transaction, timestamp) => {
    const defaults = turnDefaults({
        ...input,
        state: 'HUMAN_REQUIRED',
        recoveryKind: input.recoveryKind || input.reason,
        recoveryReason: input.recoveryReason || input.reason,
        finalState: 'HUMAN_REQUIRED',
    }, timestamp);
    defaults.handoff_created_at = timestamp;
    defaults.hard_timeout_at = input.hardTimeoutAt || null;
    const where = { turn_id: defaults.turn_id, conversation_id: defaults.conversation_id };
    const [turn, created] = await ConversationTurn.findOrCreate({ where, defaults, transaction });
    if (!created) {
        const transitions = Array.isArray(turn.state_transitions) ? turn.state_transitions : [];
        await turn.update({
            state: 'HUMAN_REQUIRED',
            recovery_kind: defaults.recovery_kind,
            recovery_reason: defaults.recovery_reason,
            handoff_created_at: turn.handoff_created_at || timestamp,
            final_state: 'HUMAN_REQUIRED',
            state_transitions: [...transitions, transitionEntry(turn.state, 'HUMAN_REQUIRED', timestamp, { reason: defaults.recovery_reason })],
        }, { transaction });
    }
    return turn;
};

/** Flip HITL and persist the durable recovery record atomically, then hand off. */
const requireHuman = async (input = {}) => {
    const turnId = requiredText(input.turnId, 'turnId');
    const conversationId = requiredText(input.conversationId, 'conversationId');
    const shopId = requiredText(input.shopId, 'shopId');
    const timestamp = now();
    let turn;

    await sequelize.transaction(async (transaction) => {
        const [updated] = await Conversation.update(
            { hitl: true },
            { where: { id: conversationId, shop_id: shopId }, transaction },
        );
        if (updated === 0) throw new Error('Conversation not found for human recovery');
        turn = await createOrUpdateHumanTurn({ ...input, turnId, conversationId, shopId }, transaction, timestamp);
    });

    const conversation = input.conversation || await Conversation.findOne({ where: { id: conversationId, shop_id: shopId } });
    const handoff = await escalateToHuman({
        conversation,
        shopId,
        conversationId,
        platform: input.platform,
        recipientId: input.recipientId,
        channel: input.channel,
        reason: input.reason || input.recoveryReason,
    });
    return { turn, handoff };
};

const isHoldingSuppressed = (state) => HOLDING_SUPPRESSED_STATES.has(state);
const isHardTimeoutSuppressed = (state) => TERMINAL_STATES.has(state);

module.exports = {
    CUSTOMER_STATES,
    RETRY_STATES,
    isHardTimeoutSuppressed,
    isHoldingSuppressed,
    requireHuman,
    startTurn,
    transition,
    _private: { findTurn, transitionEntry, turnDefaults },
};
