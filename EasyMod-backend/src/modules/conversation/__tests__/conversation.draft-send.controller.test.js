'use strict';

const mockApproveAiDraft = jest.fn();
const mockMapMessage = jest.fn((message) => message);
const mockConversationFindOne = jest.fn();
const mockMessageFindOne = jest.fn();
const mockMessageUpdate = jest.fn();
const mockProviderSend = jest.fn();

jest.mock('../conversation.service', () => ({
    approveAiDraft: mockApproveAiDraft,
    dismissAiDraft: jest.fn(),
    markConversationRead: jest.fn(),
    mapMessage: mockMapMessage,
}));
jest.mock('../escalation-auto-reply.service', () => ({ sendEscalationAutoReply: jest.fn() }));
jest.mock('../../entities', () => ({
    Conversation: { findOne: mockConversationFindOne, update: jest.fn() },
    Customer: {},
    Message: { findOne: mockMessageFindOne, update: mockMessageUpdate },
}));
jest.mock('../../channel-providers/meta-channel.service', () => ({
    findConnectedById: jest.fn(),
    findUniqueConnectedByShopAndPlatform: jest.fn(),
}));
jest.mock('../../channel-providers/provider.registry', () => ({ getProvider: jest.fn(() => ({ sendMessage: mockProviderSend })) }));
jest.mock('../../policy/policy.engine', () => ({ evaluateOutbound: jest.fn(async () => ({ allow: true })) }));
jest.mock('../../../utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('../../../config/redis', () => ({ cacheRedis: { setex: jest.fn(), del: jest.fn() } }));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(),
        define: jest.fn(() => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() })),
    },
}));

const metaChannelService = require('../../channel-providers/meta-channel.service');
const { getProvider } = require('../../channel-providers/provider.registry');
const controller = require('../conversation.controller');

const candidate = {
    id: 'draft-1',
    conversation_id: 'conversation-1',
    content: 'Approved text',
    sender: 'ai',
    metadata: { delivery_state: 'SEND_PENDING', delivery_status: 'pending', delivered: false },
    delivery_state: 'SEND_PENDING',
    delivery_source: 'DRAFT_APPROVAL',
};
const conversation = {
    id: 'conversation-1',
    shop_id: 'shop-1',
    channel: 'facebook',
    meta_channel_id: 'channel-1',
    customer: { channel_user_id: 'psid-1' },
};
const channel = { id: 'channel-1', shop_id: 'shop-1', platform: 'facebook', status: 'CONNECTED' };

const response = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
});

beforeEach(() => {
    jest.clearAllMocks();
    mockApproveAiDraft.mockResolvedValue({ message: candidate, alreadySent: false });
    mockMessageFindOne.mockResolvedValue({ ...candidate, delivery_state: 'SENT', provider_message_id: 'mid-1' });
    mockMessageUpdate.mockResolvedValue([1]);
    mockConversationFindOne.mockResolvedValue(conversation);
    metaChannelService.findConnectedById.mockResolvedValue(channel);
    mockProviderSend.mockResolvedValue({ providerMessageId: 'mid-1' });
});

describe('draft approval controller boundary', () => {
    it('performs zero provider sends before approval and exactly one after approval', async () => {
        expect(mockProviderSend).not.toHaveBeenCalled();

        const res = response();
        await controller.approveAiDraft({
            params: { conversationId: 'conversation-1', messageId: 'draft-1' },
            body: { content: 'Approved text' },
            user: { shopId: 'shop-1', userId: 'merchant-1' },
        }, res, jest.fn());

        expect(mockProviderSend).toHaveBeenCalledTimes(1);
        expect(mockProviderSend.mock.calls[0][0].normalizedMessage.text).toBe('Approved text');
        expect(mockApproveAiDraft).toHaveBeenCalledWith(
            'conversation-1',
            'shop-1',
            'draft-1',
            'Approved text',
            'merchant-1',
        );
    });

    it('does not send again when the approval transition is already complete', async () => {
        mockApproveAiDraft.mockResolvedValue({
            message: { ...candidate, delivery_state: 'SENT', provider_message_id: 'mid-1' },
            alreadySent: true,
        });

        const res = response();
        await controller.approveAiDraft({
            params: { conversationId: 'conversation-1', messageId: 'draft-1' },
            body: {},
            user: { shopId: 'shop-1', userId: 'merchant-1' },
        }, res, jest.fn());

        expect(mockProviderSend).not.toHaveBeenCalled();
    });

    it('does not project a pre-provider failure as SENT', async () => {
        mockConversationFindOne.mockResolvedValue({
            ...conversation,
            customer: { channel_user_id: null },
        });

        await controller._deliverViaMetaIfApplicable('conversation-1', 'shop-1', candidate);

        expect(mockProviderSend).not.toHaveBeenCalled();
        expect(mockMessageUpdate).not.toHaveBeenCalledWith(
            expect.objectContaining({ delivery_state: 'SENT' }),
            expect.anything(),
        );
    });

    it('holds the candidate as failed when the provider omits its message ID', async () => {
        mockProviderSend.mockResolvedValue({ providerMessageId: null, providerMessageIds: [null] });
        const outboundMessage = {
            ...candidate,
            provider_message_id: null,
            metadata: { ...candidate.metadata, provider_send_attempted: false },
        };

        await controller._deliverViaMetaIfApplicable('conversation-1', 'shop-1', outboundMessage);

        expect(mockProviderSend).toHaveBeenCalledTimes(1);
        expect(mockMessageUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ delivery_state: 'FAILED' }),
            expect.anything(),
        );
        expect(mockMessageUpdate).not.toHaveBeenCalledWith(
            expect.objectContaining({ delivery_state: 'SENT' }),
            expect.anything(),
        );
    });

    it('does not report provider success when local acknowledgement persistence is lost', async () => {
        mockMessageUpdate
            .mockResolvedValueOnce([1])
            .mockResolvedValueOnce([1])
            .mockResolvedValueOnce([0]);
        mockMessageFindOne.mockResolvedValue({
            ...candidate,
            delivery_state: 'SEND_PENDING',
            provider_message_id: null,
            metadata: { ...candidate.metadata, provider_send_attempted: true },
        });

        const result = await controller._deliverViaMetaIfApplicable(
            'conversation-1',
            'shop-1',
            {
                ...candidate,
                provider_message_id: null,
                metadata: {
                    ...candidate.metadata,
                    provider_send_attempted: false,
                    provider_send_claimed: false,
                },
            },
        );

        expect(mockProviderSend).toHaveBeenCalledTimes(1);
        expect(result).toEqual(expect.objectContaining({
            sent: false,
            reason: expect.stringContaining('requires reconciliation'),
        }));
    });
});
