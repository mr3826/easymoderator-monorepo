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

const { Op } = require('sequelize');
const { Message } = require('src/modules/conversation/conversation.entity');
const { _private } = require('src/jobs/message-worker');

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

    it('does not count held AI drafts as customer-visible replies', async () => {
        Message.findAll.mockResolvedValueOnce([
            { id: 'ai-1', metadata: { delivered: false, held_reason: 'draft_mode' } },
            { id: 'ai-2', metadata: { delivered: false, held_reason: 'low_confidence' } },
        ]);

        await expect(_private.hasPriorCustomerVisibleAiReply('conv-1')).resolves.toBe(false);
    });

    it('counts delivered AI replies as customer-visible replies', async () => {
        Message.findAll.mockResolvedValueOnce([
            { id: 'ai-1', metadata: { delivered: false, held_reason: 'draft_mode' } },
            { id: 'ai-2', metadata: { delivered: true } },
        ]);

        await expect(_private.hasPriorCustomerVisibleAiReply('conv-1')).resolves.toBe(true);
    });

    it('treats legacy AI rows without delivery metadata as visible', async () => {
        Message.findAll.mockResolvedValueOnce([
            { id: 'ai-1', metadata: null },
        ]);

        await expect(_private.hasPriorCustomerVisibleAiReply('conv-1')).resolves.toBe(true);
    });

    it('queries prior AI rows in the same conversation only', async () => {
        Message.findAll.mockResolvedValueOnce([]);

        await _private.hasPriorCustomerVisibleAiReply('conv-1');

        expect(Message.findAll).toHaveBeenCalledWith({
            where: { conversation_id: 'conv-1', sender: 'ai' },
            attributes: ['id', 'metadata'],
            order: [['created_at', 'ASC']],
        });
    });
});
