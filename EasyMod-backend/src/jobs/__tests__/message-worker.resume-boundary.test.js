'use strict';

process.env.NODE_ENV = 'test';

const mockConversationFindOne = jest.fn();
const mockMessageFindOne = jest.fn();
const mockMessageUpdate = jest.fn();
const mockSseEmit = jest.fn();

jest.mock('bullmq', () => ({
    Worker: jest.fn(),
    Queue: jest.fn(() => ({ add: jest.fn() })),
    UnrecoverableError: class UnrecoverableError extends Error {},
}));
jest.mock('src/jobs/message-queue', () => ({ connection: {} }));
jest.mock('src/config/redis', () => ({
    cacheRedis: { get: jest.fn(async () => null), set: jest.fn(), setex: jest.fn(), del: jest.fn() },
}));
jest.mock('src/utils/ops-alert', () => ({ opsAlert: jest.fn(async () => {}) }));
jest.mock('src/utils/sse-manager', () => ({ emit: mockSseEmit }));
jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: { findOne: mockConversationFindOne, update: jest.fn() },
    Message: {
        findOne: mockMessageFindOne,
        update: mockMessageUpdate,
        findAll: jest.fn(async () => []),
        count: jest.fn(async () => 0),
    },
}));
jest.mock('src/modules/conversation/conversation-state-standalone.service', () => ({}));
jest.mock('src/modules/channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('src/modules/policy/policy.engine', () => ({ evaluateOutbound: jest.fn() }));
jest.mock('src/modules/channel-providers/meta-channel.service', () => ({}));
jest.mock('src/modules/customer/customer.entity', () => ({}));
jest.mock('src/modules/entities', () => ({}));
jest.mock('src/modules/shop/shop.service', () => ({}));
jest.mock('src/modules/shop/ai-messaging', () => ({}));
jest.mock('src/modules/shop/shop.entity', () => ({}));
jest.mock('src/modules/ai/sentiment.service', () => ({}));
jest.mock('src/modules/conversation/order-flow.service', () => ({}));
jest.mock('src/modules/conversation/ai-chatbot.controller', () => ({}));
jest.mock('src/modules/conversation/human-handoff.service', () => ({}));
jest.mock('src/modules/knowledge/knowledge-gap-capture.service', () => ({}));
jest.mock('src/modules/analytics/growth-metrics.service', () => ({}));
jest.mock('src/modules/analytics/funnel-events.service', () => ({}));

const { _private } = require('../message-worker');

beforeEach(() => {
    jest.clearAllMocks();
});

test('finalizer cannot resurrect a candidate dismissed by Resume between read and update', async () => {
    const boundary = new Date(Date.now() - 1_000).toISOString();
    const pending = {
        id: 'ai-1',
        conversation_id: 'conv-1',
        sender: 'ai',
        content: 'old reply',
        created_at: new Date(Date.now() - 2_000),
        delivery_state: 'HELD',
        delivery_source: 'AUTO',
        metadata: {
            delivery_state: 'HELD',
            turn_started_at: new Date(Date.now() - 2_000).toISOString(),
        },
        update: jest.fn(),
    };
    const dismissed = {
        ...pending,
        delivery_state: 'DISMISSED',
        metadata: {
            ...pending.metadata,
            delivery_state: 'DISMISSED',
            suggestion_visibility: 'HIDDEN_DISMISSED',
            held_reason: 'resume_obsolete',
        },
    };
    mockMessageFindOne
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(dismissed);
    mockMessageUpdate.mockResolvedValue([0]);
    mockConversationFindOne.mockResolvedValue({
        id: 'conv-1',
        metadata: { ai_resume_boundary_at: boundary },
    });

    const result = await _private.finalizeAiMessage(pending, 'shop-1', 'conv-1', {
        delivered: false,
        heldReason: 'human_active',
        deliveryState: 'HELD',
        suggestionVisibility: 'VISIBLE_HITL_REVIEW',
    });

    expect(result).toEqual(expect.objectContaining({ resumeObsolete: true }));
    expect(pending.update).not.toHaveBeenCalled();
    expect(mockSseEmit).not.toHaveBeenCalledWith('shop-1', 'new_message', expect.anything());
});
