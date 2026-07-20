'use strict';

process.env.NODE_ENV = 'test';

jest.mock('bullmq', () => ({
    Worker: jest.fn(),
    Queue: jest.fn(),
}));
jest.mock('src/jobs/message-queue', () => ({ connection: {} }));
jest.mock('src/config/redis', () => ({
    cacheRedis: { get: jest.fn(), set: jest.fn(), setex: jest.fn() },
}));
jest.mock('src/utils/ops-alert', () => ({ opsAlert: jest.fn() }));
jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: {},
    Message: { count: jest.fn(), findAll: jest.fn() },
}));
jest.mock('src/modules/conversation/conversation-state-standalone.service', () => ({}));
jest.mock('src/modules/channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('src/utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('src/modules/policy/policy.engine', () => ({ evaluateOutbound: jest.fn() }));
jest.mock('src/modules/channel-providers/meta-channel.service', () => ({}));
jest.mock('src/modules/channel-providers/meta-channel.entity', () => ({}));
jest.mock('src/modules/customer/customer.entity', () => ({}));
jest.mock('src/modules/conversation/order-flow.service', () => ({
    hasPurchaseIntent: jest.fn((message) => String(message || '').toLowerCase().includes('order korbo')),
}));

const { Op } = require('sequelize');
const { Message } = require('src/modules/conversation/conversation.entity');
const { _private } = require('src/jobs/message-worker');
const { hasPurchaseIntent } = require('src/modules/conversation/order-flow.service');

describe('message-worker first customer turn detection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('treats a turn as first when no prior customer messages exist outside the current turn', async () => {
        Message.count.mockResolvedValueOnce(0);

        await expect(_private.isFirstCustomerTurn('conv-1', ['msg-1', 'msg-2'])).resolves.toBe(true);

        expect(Message.count).toHaveBeenCalledWith({
            where: {
                conversation_id: 'conv-1',
                sender: 'customer',
                id: { [Op.notIn]: ['msg-1', 'msg-2'] },
            },
        });
    });

    it('does not treat later customer turns as first', async () => {
        Message.count.mockResolvedValueOnce(1);

        await expect(_private.isFirstCustomerTurn('conv-1', ['msg-3'])).resolves.toBe(false);
    });

    it('falls back safely when a legacy job does not include a current message id', async () => {
        Message.count.mockResolvedValueOnce(1);
        await expect(_private.isFirstCustomerTurn('conv-1', [])).resolves.toBe(true);

        Message.count.mockResolvedValueOnce(2);
        await expect(_private.isFirstCustomerTurn('conv-1', [])).resolves.toBe(false);
    });
});

describe('message-worker first customer-visible AI disclosure detection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not count held AI drafts as customer-visible disclosures', async () => {
        Message.findAll.mockResolvedValueOnce([
            { id: 'ai-1', content: 'Hi, I am the AI assistant from Demo Shop.', metadata: { delivered: false, held_reason: 'draft_mode' } },
            { id: 'ai-2', content: 'Hi, I am the AI assistant from Demo Shop.', metadata: { delivered: false, held_reason: 'low_confidence' } },
        ]);

        await expect(_private.hasPriorCustomerVisibleAiDisclosure('conv-1')).resolves.toBe(false);
    });

    it('does not count delivered AI replies that never disclosed the assistant', async () => {
        Message.findAll.mockResolvedValueOnce([
            { id: 'ai-1', content: 'Hello! How can I help you today?', metadata: { delivered: true } },
        ]);

        await expect(_private.hasPriorCustomerVisibleAiDisclosure('conv-1')).resolves.toBe(false);
    });

    it('counts delivered AI replies with disclosure text as customer-visible disclosures', async () => {
        Message.findAll.mockResolvedValueOnce([
            { id: 'ai-1', content: 'Hello! How can I help you today?', metadata: { delivered: true } },
            { id: 'ai-2', content: "Hi, I'm the AI assistant from Demo Shop.\n\nHello!", metadata: { delivered: true } },
        ]);

        await expect(_private.hasPriorCustomerVisibleAiDisclosure('conv-1')).resolves.toBe(true);
    });

    it('counts the persisted disclosure metadata flag', async () => {
        Message.findAll.mockResolvedValueOnce([
            { id: 'ai-1', content: 'Custom localized disclosure', metadata: { delivered: true, ai_disclosure_applied: true } },
        ]);

        await expect(_private.hasPriorCustomerVisibleAiDisclosure('conv-1')).resolves.toBe(true);
    });

    it('recognizes legacy Bangla disclosure text', () => {
        expect(_private.hasAiDisclosure({
            content: 'হাই, আমি Demo Shop-এর AI সহকারী।',
            metadata: {},
        })).toBe(true);
    });

    it('queries prior AI rows in the same conversation only', async () => {
        Message.findAll.mockResolvedValueOnce([]);

        await _private.hasPriorCustomerVisibleAiDisclosure('conv-1');

        expect(Message.findAll).toHaveBeenCalledWith({
            where: { conversation_id: 'conv-1', sender: 'ai' },
            attributes: ['id', 'content', 'metadata'],
            order: [['created_at', 'ASC']],
        });
    });
});

describe('message-worker automation mode helpers', () => {
    it('normalizes legacy AUTO mode to AI_ACTIVE', () => {
        expect(_private.normalizeAutomationMode('AUTO')).toBe('AI_ACTIVE');
        expect(_private.normalizeAutomationMode('AI_ACTIVE')).toBe('AI_ACTIVE');
    });

    it('treats shop MANUAL as a hard kill switch', () => {
        expect(_private.isShopManualKillSwitch({ automation_mode: 'MANUAL' })).toBe(true);
        expect(_private.isShopManualKillSwitch({ automation_mode: 'AI_ACTIVE' })).toBe(false);
        expect(_private.isShopManualKillSwitch({ automation_mode: 'AUTO' })).toBe(false);
    });
});

describe('message-worker order-flow failure fallback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        hasPurchaseIntent.mockImplementation((message) => String(message || '').toLowerCase().includes('order korbo'));
    });

    it('handles purchase intent safely instead of letting the LLM claim an order started', () => {
        const result = _private.buildOrderFlowFailureResponse('order korbo', 'bn');

        expect(result).toEqual(expect.objectContaining({
            handled: true,
            confidence: 1.0,
            sourceReferences: null,
            meta: { order_session: 'unavailable', reason: 'order_flow_error' },
        }));
        expect(result.response).toContain('অর্ডার সিস্টেমটি');
        expect(result.response).not.toMatch(/শুরু হয়ে যাবে|started|processing/i);
    });

    it('leaves non-purchase messages on the normal AI path', () => {
        expect(_private.buildOrderFlowFailureResponse('price koto?', 'bn')).toBeNull();
    });
});
