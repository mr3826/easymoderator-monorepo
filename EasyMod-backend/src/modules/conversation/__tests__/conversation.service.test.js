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

const { Conversation } = require('../../entities');
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
