'use strict';

const mockConversationFindOne = jest.fn();
const mockMessageFindOne = jest.fn();
const mockMessageCreate = jest.fn();

jest.mock('../conversation.entity', () => ({
    Conversation: { findOne: mockConversationFindOne },
    Message: { findOne: mockMessageFindOne, create: mockMessageCreate },
}));
jest.mock('../../shop/shop.service', () => ({
    getShopAiSettings: jest.fn(async () => ({})),
}));

const { sendEscalationAutoReply } = require('../escalation-auto-reply.service');

beforeEach(() => {
    jest.clearAllMocks();
    mockConversationFindOne.mockResolvedValue({
        id: 'conversation-1',
        shop_id: 'shop-1',
        channel: 'messenger',
    });
    mockMessageFindOne.mockResolvedValue(null);
    mockMessageCreate.mockImplementation(async (attributes) => ({
        ...attributes,
        created_at: new Date(),
    }));
});

test('scopes escalation idempotency to the logical turn after Resume', async () => {
    const turnStartedAt = new Date().toISOString();
    await sendEscalationAutoReply('conversation-1', 'shop-1', 'messenger', {
        logicalTurnId: 'burst:new-turn',
        turnStartedAt,
    });

    expect(mockMessageFindOne).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
            conversation_id: 'conversation-1',
            delivery_source: 'HITL_ESCALATION',
            send_idempotency_key: expect.any(String),
        }),
    }));
    expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
        send_idempotency_key: expect.any(String),
        metadata: expect.objectContaining({
            logical_turn_id: 'burst:new-turn',
            turn_started_at: turnStartedAt,
        }),
    }));
});
