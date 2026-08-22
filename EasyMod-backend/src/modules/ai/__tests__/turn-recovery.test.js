'use strict';

const mockTransaction = jest.fn(async callback => callback({ id: 'tx-1' }));
const mockConversationUpdate = jest.fn(async () => [1]);
const mockConversationFindOne = jest.fn(async () => ({ id: 'conv-1', hitl: true }));
const mockTurnUpdate = jest.fn(async function update(values) { Object.assign(this, values); return this; });
const mockTurn = {
    turn_id: 'turn-1',
    conversation_id: 'conv-1',
    state: 'RECEIVED',
    state_transitions: [],
    handoff_created_at: null,
    update: mockTurnUpdate,
};
const mockFindOrCreate = jest.fn();
const mockHandoff = jest.fn(async () => ({ id: 'handoff-1' }));

jest.mock('src/utils/database/database-setup', () => ({ sequelize: { transaction: mockTransaction } }));
jest.mock('src/modules/conversation/conversation-turn.entity', () => ({ findOrCreate: mockFindOrCreate, findOne: jest.fn() }));
jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: { update: mockConversationUpdate, findOne: mockConversationFindOne },
}));
jest.mock('src/modules/conversation/human-handoff.service', () => ({ escalateToHuman: mockHandoff }));

const recovery = require('../recovery/turn-recovery.service');
const { HOLDING_TEMPLATES, getHoldingTemplate } = require('../recovery/holding-templates');

beforeEach(() => {
    jest.clearAllMocks();
    mockTurn.state = 'RECEIVED';
    mockTurn.state_transitions = [];
    mockTurn.handoff_created_at = null;
});

test('freezes exactly the normative 14 customer states and 7 retry states', () => {
    expect(recovery.CUSTOMER_STATES).toHaveLength(14);
    expect(recovery.RETRY_STATES).toHaveLength(7);
    expect(Object.isFrozen(recovery.CUSTOMER_STATES)).toBe(true);
    expect(Object.isFrozen(recovery.RETRY_STATES)).toBe(true);
});

test('startTurn stamps the first durable start once across a replay', async () => {
    mockFindOrCreate
        .mockResolvedValueOnce([mockTurn, true])
        .mockResolvedValueOnce([mockTurn, false]);

    const first = await recovery.startTurn({
        turnId: 'turn-1', traceId: 'trace-1', shopId: 'shop-1', conversationId: 'conv-1',
    });
    const startedAt = mockFindOrCreate.mock.calls[0][0].defaults.turn_started_at;
    const replay = await recovery.startTurn({
        turnId: 'turn-1', traceId: 'trace-retry', shopId: 'shop-1', conversationId: 'conv-1',
    });

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(mockFindOrCreate.mock.calls[1][0].defaults.turn_started_at).not.toBe(startedAt);
    expect(replay.turn).toBe(mockTurn);
    expect(mockTurnUpdate).not.toHaveBeenCalled();
});

test('transition appends a state transition and rejects unknown states', async () => {
    mockFindOrCreate.mockResolvedValue([mockTurn, false]);
    const { startTurn } = recovery;
    await startTurn({ turnId: 'turn-1', traceId: 'trace-1', shopId: 'shop-1', conversationId: 'conv-1' });
    await recovery.transition(mockTurn, 'AGENT_RUNNING', { reason: 'context_ready' });
    expect(mockTurnUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'AGENT_RUNNING' }), undefined);
    expect(mockTurn.state_transitions.at(-1)).toEqual(expect.objectContaining({ state: 'AGENT_RUNNING', reason: 'context_ready' }));
    await expect(recovery.transition(mockTurn, 'NOT_A_STATE')).rejects.toThrow(/Unsupported customer state/);
});

test('requireHuman commits hitl and the recovery row before calling handoff', async () => {
    mockFindOrCreate.mockResolvedValue([mockTurn, true]);
    const result = await recovery.requireHuman({
        turnId: 'turn-1', traceId: 'trace-1', shopId: 'shop-1', conversationId: 'conv-1',
        reason: 'ACTION_DENIED', conversation: { id: 'conv-1', hitl: false },
        platform: 'facebook', recipientId: 'recipient-1', channel: null,
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockConversationUpdate).toHaveBeenCalledWith(
        { hitl: true },
        expect.objectContaining({ where: { id: 'conv-1', shop_id: 'shop-1' }, transaction: { id: 'tx-1' } }),
    );
    expect(mockFindOrCreate).toHaveBeenCalledWith(expect.objectContaining({ transaction: { id: 'tx-1' } }));
    expect(mockHandoff).toHaveBeenCalledTimes(1);
    expect(result.handoff).toEqual({ id: 'handoff-1' });
});

test('a recovery write failure does not call handoff after the transaction aborts', async () => {
    mockFindOrCreate.mockRejectedValue(new Error('turn write failed'));

    await expect(recovery.requireHuman({
        turnId: 'turn-1', traceId: 'trace-1', shopId: 'shop-1', conversationId: 'conv-1',
        reason: 'RETRIEVAL_FAILURE', conversation: { id: 'conv-1' },
    })).rejects.toThrow('turn write failed');
    expect(mockHandoff).not.toHaveBeenCalled();
});

test('holding templates remain free of unsupported commercial promises', () => {
    const forbidden = /price|discount|scarcity|delivery|stock|\b\d+\b|৳/i;
    for (const reason of Object.keys(HOLDING_TEMPLATES)) {
        expect(getHoldingTemplate(reason, 'en')).not.toMatch(forbidden);
        expect(getHoldingTemplate(reason, 'banglish')).not.toMatch(forbidden);
    }
});
