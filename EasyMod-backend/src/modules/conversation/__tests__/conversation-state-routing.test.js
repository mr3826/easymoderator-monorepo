'use strict';

const customer = {
    id: 'customer-1',
    name: 'Facebook User',
    channel_user_id: 'psid-1',
};
const mockCustomer = {
    findOne: jest.fn(),
    create: jest.fn(),
};
const mockConversation = {
    findOne: jest.fn(),
    create: jest.fn(),
};
const mockMessage = {
    create: jest.fn(),
    findAll: jest.fn(),
};
const mockOrderSessionService = {
    getActiveSession: jest.fn(),
};

jest.mock('../../customer/customer.entity', () => mockCustomer);
jest.mock('../conversation.entity', () => ({
    Conversation: mockConversation,
    Message: mockMessage,
}));
jest.mock('../../order/order-session-standalone.service', () => mockOrderSessionService);

const ConversationStateService = require('../conversation-state-standalone.service');

const baseData = (overrides = {}) => ({
    shop_id: 'shop-1',
    customer_channel_id: 'psid-1',
    platform: 'facebook',
    message: 'Hello',
    metadata: { message_id: 'mid-1' },
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockCustomer.findOne.mockResolvedValue(customer);
    mockConversation.findOne.mockResolvedValue(null);
    mockConversation.create.mockResolvedValue({
        id: 'conversation-new',
        status: 'active',
        metadata: {},
        update: jest.fn().mockResolvedValue(undefined),
    });
    mockMessage.create.mockResolvedValue({ id: 'message-1' });
    mockMessage.findAll.mockResolvedValue([]);
    mockOrderSessionService.getActiveSession.mockResolvedValue(null);
});

describe('ConversationStateService exact Meta channel routing', () => {
    test('does not reuse or lazy-pin an unpinned legacy row when a Page channel is supplied', async () => {
        const legacyConversation = {
            id: 'conversation-legacy',
            meta_channel_id: null,
            status: 'active',
            metadata: {},
            update: jest.fn().mockResolvedValue(undefined),
        };
        mockConversation.findOne.mockResolvedValue(legacyConversation);

        const result = await ConversationStateService.ingestMessage(baseData({
            meta_channel_id: 'channel-a',
        }));

        expect(mockConversation.findOne).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ meta_channel_id: 'channel-a' }),
        }));
        expect(legacyConversation.update).not.toHaveBeenCalled();
        expect(mockConversation.create).toHaveBeenCalledWith(
            expect.objectContaining({ meta_channel_id: 'channel-a' }),
        );
        expect(result.conversation_id).toBe('conversation-new');
    });

    test('reuses only a conversation pinned to the supplied exact channel', async () => {
        const pinnedConversation = {
            id: 'conversation-a',
            meta_channel_id: 'channel-a',
            status: 'active',
            metadata: {},
            update: jest.fn().mockResolvedValue(undefined),
        };
        mockConversation.findOne.mockResolvedValue(pinnedConversation);

        const result = await ConversationStateService.ingestMessage(baseData({
            meta_channel_id: 'channel-a',
        }));

        expect(mockConversation.create).not.toHaveBeenCalled();
        expect(mockMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({ conversation_id: 'conversation-a' }),
        );
        expect(result.conversation_id).toBe('conversation-a');
    });
});
