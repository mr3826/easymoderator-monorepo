'use strict';

jest.mock('../../conversation/conversation.service', () => ({
    getConversations: jest.fn(),
    getConversationById: jest.fn(),
    getMessages: jest.fn(),
}));

const conversationService = require('../../conversation/conversation.service');
const controller = require('../mobile-inbox.controller');

function response() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

describe('mobile Inbox read contract', () => {
    beforeEach(() => jest.clearAllMocks());

    test('lists only bounded shop-scoped conversation data', async () => {
        const res = response();
        conversationService.getConversations.mockResolvedValue({ conversations: [], pagination: { total: 0 } });

        await controller.getConversations({
            shop: { id: 'shop-a' },
            query: { page: '2', limit: '999', channel: 'messenger' },
        }, res, jest.fn());

        expect(conversationService.getConversations).toHaveBeenCalledWith('shop-a', {
            page: 2,
            limit: 50,
            channel: 'messenger',
        });
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('passes the current shop to conversation detail and transcript reads', async () => {
        const res = response();
        conversationService.getConversationById.mockResolvedValue({ id: 'conversation-a' });
        conversationService.getMessages.mockResolvedValue({ messages: [], suggestions: [], pagination: { total: 0 } });

        await controller.getConversation({ params: { conversationId: 'conversation-a' }, shop: { id: 'shop-a' } }, res, jest.fn());
        await controller.getMessages({
            params: { conversationId: 'conversation-a' },
            query: { page: '1', limit: '25' },
            shop: { id: 'shop-a' },
        }, res, jest.fn());

        expect(conversationService.getConversationById).toHaveBeenCalledWith('conversation-a', 'shop-a');
        expect(conversationService.getMessages).toHaveBeenCalledWith('conversation-a', 'shop-a', { page: 1, limit: 25 });
    });

    test('rejects an empty conversation id before reaching the service', async () => {
        const next = jest.fn();
        await controller.getConversation({ params: { conversationId: '' }, shop: { id: 'shop-a' } }, response(), next);

        expect(conversationService.getConversationById).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 }));
    });
});
