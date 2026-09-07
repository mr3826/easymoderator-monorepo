'use strict';

const mockTransaction = {
    id: 'conversation-transaction',
    commit: jest.fn(),
    rollback: jest.fn(),
};
const mockConversation = {
    id: 'conversation-1',
    channel: 'messenger',
    customer_id: 'customer-1',
};
const mockLogger = {
    logUsage: jest.fn(),
    error: jest.fn(),
};

jest.mock('../../entities', () => ({
    Conversation: { create: jest.fn() },
    Message: {},
    Customer: {},
    MetaChannel: {},
    MetaChannelSettings: {},
}));
jest.mock('../../subscription/subscription.service', () => ({
    trackUsage: jest.fn(),
}));
jest.mock('../../shop/shop.service', () => ({
    getShopAiSettings: jest.fn(),
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(),
    },
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => mockLogger),
}));

const { Conversation, Message } = require('../../entities');
const subscriptionService = require('../../subscription/subscription.service');
const shopService = require('../../shop/shop.service');
const { sequelize } = require('../../../utils/database/database-setup');
const conversationService = require('../conversation.service');

beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.commit.mockResolvedValue(undefined);
    mockTransaction.rollback.mockResolvedValue(undefined);
    sequelize.transaction.mockResolvedValue(mockTransaction);
    Conversation.create.mockResolvedValue(mockConversation);
    shopService.getShopAiSettings.mockResolvedValue({ automation_mode: 'AI_ACTIVE' });
});

describe('conversation creation after commit', () => {
    it('returns the committed conversation when post-commit usage metering fails', async () => {
        const usageError = new Error('meter unavailable');
        usageError.code = 'USAGE_METER_UNAVAILABLE';
        subscriptionService.trackUsage.mockRejectedValue(usageError);

        await expect(conversationService.createConversation(
            'shop-1',
            { customer_id: 'customer-1', channel: 'messenger', message: 'Hello' },
            'request-1',
        )).resolves.toBe(mockConversation);

        expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
        expect(mockTransaction.rollback).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(
            'Failed to track conversation usage',
            usageError,
            expect.objectContaining({ conversationId: 'conversation-1' }),
        );
    });
});

describe('conversation list reply-mode envelope', () => {
    it('reads the business mode once and returns the normalized mode', async () => {
        const row = {
            id: 'conversation-1',
            customer_id: 'customer-1',
            channel: 'messenger',
            metadata: {},
            hitl: false,
            customer: null,
            metaChannel: null,
            message: null,
        };
        Conversation.findAndCountAll = jest.fn().mockResolvedValue({ rows: [row], count: 1 });
        shopService.getShopAiSettings.mockResolvedValue({ automation_mode: 'AI_ACTIVE' });

        const result = await conversationService.getConversations('shop-1');

        expect(result).toEqual(expect.objectContaining({
            ai_reply_mode: 'AUTO',
            conversations: [expect.objectContaining({ id: 'conversation-1' })],
        }));
        expect(shopService.getShopAiSettings).toHaveBeenCalledTimes(1);
        expect(shopService.getShopAiSettings).toHaveBeenCalledWith('shop-1');
        expect(Conversation.findAndCountAll).toHaveBeenCalledTimes(1);
    });
});

describe('message projection turn scoping', () => {
    it('does not expose a stale reviewable draft from before the latest customer turn', async () => {
        Conversation.findOne = jest.fn().mockResolvedValue({
            id: 'conversation-1',
            shop_id: 'shop-1',
        });
        const staleDraft = {
            id: 'draft-old',
            conversation_id: 'conversation-1',
            sender: 'ai',
            content: 'Old draft',
            created_at: new Date('2026-09-07T09:00:00.000Z'),
            metadata: {
                delivery_state: 'DRAFT_READY',
                logical_turn_id: 'turn-old',
                suggestion_visibility: 'VISIBLE_DRAFT_REVIEW',
            },
        };
        const latestInbound = {
            id: 'customer-new',
            conversation_id: 'conversation-1',
            sender: 'customer',
            content: 'New inbound',
            created_at: new Date('2026-09-07T09:05:00.000Z'),
            metadata: { logical_turn_id: 'turn-new' },
        };
        Message.findAndCountAll = jest.fn().mockResolvedValue({
            rows: [latestInbound, staleDraft],
            count: 2,
        });

        const result = await conversationService.getMessages('conversation-1', 'shop-1');

        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].id).toBe('customer-new');
        expect(result.suggestions).toEqual([]);
    });
});
