'use strict';

const mockConversationModel = {
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
};
const mockMessageModel = {
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
    findAll: jest.fn(),
};
const mockInboxDeliveryOutbox = {
    create: jest.fn(),
    update: jest.fn(),
};
const mockTransaction = {
    LOCK: { UPDATE: 'UPDATE' },
    finished: null,
    commit: jest.fn(async () => { mockTransaction.finished = 'commit'; }),
    rollback: jest.fn(async () => { mockTransaction.finished = 'rollback'; }),
};

jest.mock('../../entities', () => ({
    Conversation: mockConversationModel,
    Message: mockMessageModel,
    Customer: {},
    MetaChannel: {},
    MetaChannelSettings: {},
    InboxDeliveryOutbox: mockInboxDeliveryOutbox,
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: { transaction: jest.fn(async () => mockTransaction) },
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
}));
jest.mock('../../shop/ai-reply-mode', () => ({
    getEffectiveAiReplyMode: jest.fn(async () => 'AUTO'),
    AI_REPLY_MODES: { AUTO: 'AUTO', DRAFT: 'DRAFT', MANUAL: 'MANUAL' },
}));

const conversationService = require('../conversation.service');
const { getEffectiveAiReplyMode } = require('../../shop/ai-reply-mode');

const customerMessage = {
    id: 'customer-message',
    conversation_id: 'conversation-1',
    sender: 'customer',
    content: 'Hello',
    created_at: new Date('2026-09-04T10:00:00Z'),
    metadata: {},
};
const draftMessage = {
    id: 'draft-message',
    conversation_id: 'conversation-1',
    sender: 'ai',
    content: 'Draft reply',
    ai_suggestion: 'Draft reply',
    delivery_state: 'DRAFT_READY',
    delivery_source: 'AI_DRAFT',
    metadata: {
        delivered: false,
        delivery_state: 'DRAFT_READY',
        suggestion_visibility: 'VISIBLE_DRAFT_REVIEW',
    },
    created_at: new Date('2026-09-04T10:01:00Z'),
    update: jest.fn(async (updates) => Object.assign(draftMessage, updates)),
};

beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.finished = null;
    mockInboxDeliveryOutbox.create.mockResolvedValue({ id: 'outbox-1' });
});

describe('ConversationService delivery projection', () => {
    it('projects customer identity instead of an internal intent enum', () => {
        const result = conversationService.mapConversation({
            id: 'conversation-1',
            channel: 'messenger',
            customer: { id: 'customer-1', name: 'Facebook User', channel_user_id: 'psid-1234' },
            title: 'GENERAL_CHAT_OR_UNKNOWN',
            intent: 'GENERAL_CHAT_OR_UNKNOWN',
            metadata: {},
        });

        expect(result.customer.name).toBe('Facebook customer · …1234');
        expect(result.title).toBe('Facebook customer · …1234');
        expect(result.title).not.toBe('GENERAL_CHAT_OR_UNKNOWN');
    });

    it('separates unsent AI suggestions from the canonical transcript', async () => {
        mockConversationModel.findOne.mockResolvedValue({ id: 'conversation-1', shop_id: 'shop-a' });
        mockMessageModel.findAndCountAll.mockResolvedValue({
            // The service reverses the database's DESC page for chronological
            // rendering, so provide the mocked rows in the same DESC order.
            rows: [{
                ...draftMessage,
                id: 'sent-message',
                content: 'Sent reply',
                delivery_state: 'SENT',
                provider_message_id: 'mid-1',
                metadata: { delivery_state: 'SENT', provider_send_confirmed: true },
            }, draftMessage, customerMessage],
            count: 3,
        });

        const result = await conversationService.getMessages('conversation-1', 'shop-a');

        expect(result.messages.map((message) => message.id)).toEqual(['customer-message', 'sent-message']);
        expect(result.suggestions.map((message) => message.id)).toEqual(['draft-message']);
        expect(result.suggestions[0]).toEqual(expect.objectContaining({
            delivery_state: 'DRAFT_READY',
            is_transcript_message: false,
        }));
    });

    it('claims a draft row before approval and does not create a second message', async () => {
        const conversation = { id: 'conversation-1', shop_id: 'shop-a', channel: 'messenger' };
        mockConversationModel.findOne.mockResolvedValue(conversation);
        mockMessageModel.findOne.mockResolvedValue(draftMessage);

        const result = await conversationService.approveAiDraft(
            'conversation-1',
            'shop-a',
            'draft-message',
            'Edited reply',
            'user-1',
        );

        expect(result.alreadySent).toBe(false);
        expect(draftMessage.update).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'Edited reply',
                delivery_state: 'SEND_PENDING',
                delivery_source: 'DRAFT_APPROVAL',
                send_idempotency_key: expect.any(String),
            }),
            { transaction: mockTransaction },
        );
        expect(mockMessageModel.findAndCountAll).not.toHaveBeenCalled();
        expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
        expect(mockInboxDeliveryOutbox.create).toHaveBeenCalledWith(
            expect.objectContaining({
                message_id: 'draft-message',
                status: 'PENDING',
                delivery_source: 'DRAFT_APPROVAL',
            }),
            { transaction: mockTransaction },
        );
    });

    it('does not dismiss a provider-attempted failed candidate', async () => {
        const attempted = {
            id: 'attempted-draft',
            conversation_id: 'conversation-1',
            sender: 'ai',
            delivery_state: 'FAILED',
            metadata: {
                delivered: false,
                delivery_state: 'FAILED',
                delivery_status: 'failed',
                provider_send_attempted: true,
                suggestion_visibility: 'VISIBLE_HITL_REVIEW',
            },
            update: jest.fn(),
        };
        const conversation = {
            id: 'conversation-1',
            shop_id: 'shop-a',
            update: jest.fn(),
        };
        mockConversationModel.findOne.mockResolvedValue(conversation);
        mockMessageModel.findOne.mockResolvedValue(attempted);

        await expect(conversationService.dismissAiDraft(
            'conversation-1',
            'shop-a',
            'attempted-draft',
            'user-1',
        )).rejects.toMatchObject({
            code: 'PROVIDER_SEND_ALREADY_ATTEMPTED',
            statusCode: 409,
        });
        expect(attempted.update).not.toHaveBeenCalled();
    });

    it('persists a read watermark and clears only the owning conversation', async () => {
        const conversation = {
            id: 'conversation-1',
            shop_id: 'shop-a',
            channel: 'messenger',
            metadata: { unreadCount: 2 },
            update: jest.fn(async (updates) => Object.assign(conversation, updates)),
        };
        mockConversationModel.findOne.mockResolvedValue(conversation);
        mockMessageModel.findOne.mockResolvedValue(customerMessage);

        const result = await conversationService.markConversationRead(
            'conversation-1',
            'shop-a',
            'customer-message',
        );

        expect(conversation.update).toHaveBeenCalledWith(
            expect.objectContaining({ metadata: expect.objectContaining({
                unreadCount: 0,
                last_read_message_id: 'customer-message',
            }) }),
            { transaction: mockTransaction },
        );
        expect(result.unreadCount).toBe(0);
        expect(result.lastReadMessageId).toBe('customer-message');
    });

    it('holds an unsent candidate when a merchant takes over', async () => {
        const candidate = {
            id: 'candidate-1',
            sender: 'ai',
            delivery_state: 'DRAFT_READY',
            metadata: { delivered: false, delivery_state: 'DRAFT_READY' },
            update: jest.fn(async (updates) => Object.assign(candidate, updates)),
        };
        mockConversationModel.findOne.mockResolvedValue({ id: 'conversation-1', shop_id: 'shop-a' });
        mockMessageModel.findAll.mockResolvedValue([candidate]);

        await expect(conversationService.holdPendingAiCandidates('conversation-1', 'shop-a'))
            .resolves.toBe(1);
        expect(candidate.delivery_state).toBe('HELD');
        expect(candidate.metadata.suggestion_visibility).toBe('VISIBLE_HITL_REVIEW');
        expect(require('../message-lifecycle').isReviewableSuggestion(candidate)).toBe(true);
    });

    it('closes the conversation and terminalizes pending AI work without exposing a stale draft', async () => {
        const pending = {
            id: 'pending-ai',
            conversation_id: 'conversation-1',
            sender: 'ai',
            created_at: new Date('2026-09-04T10:01:00Z'),
            delivery_state: 'SEND_PENDING',
            metadata: {
                delivered: false,
                delivery_state: 'SEND_PENDING',
                suggestion_visibility: 'HIDDEN_AUTO_PROCESSING',
            },
            update: jest.fn(async (updates) => Object.assign(pending, updates)),
        };
        const conversation = {
            id: 'conversation-1',
            shop_id: 'shop-a',
            status: 'active',
            hitl: true,
            metadata: {},
            update: jest.fn(async (updates) => Object.assign(conversation, updates)),
        };
        mockConversationModel.findOne.mockResolvedValue(conversation);
        mockMessageModel.findAll.mockResolvedValue([pending]);

        const result = await conversationService.updateConversation(
            'conversation-1',
            'shop-a',
            { status: 'closed' },
        );

        expect(conversation.status).toBe('closed');
        expect(conversation.hitl).toBe(false);
        expect(pending.delivery_state).toBe('HELD');
        expect(pending.metadata).toEqual(expect.objectContaining({
            held_reason: 'conversation_closed',
            suggestion_visibility: 'HIDDEN_DISMISSED',
        }));
        expect(result).toEqual(expect.objectContaining({
            status: 'closed',
            hitl: false,
            needs_merchant_reply: false,
            ai_is_replying: false,
        }));
    });

    it.each([
        {
            name: 'MANUAL inbound',
            mode: 'MANUAL',
            messages: [customerMessage],
            expected: { needs_merchant_reply: true, needs_merchant_reply_reason: 'CUSTOMER_UNANSWERED', ai_is_replying: false },
        },
        {
            name: 'MANUAL answered',
            mode: 'MANUAL',
            messages: [
                customerMessage,
                {
                    id: 'business-message',
                    conversation_id: 'conversation-1',
                    sender: 'business',
                    created_at: new Date('2026-09-04T10:02:00Z'),
                    delivery_state: 'SENT',
                    metadata: { delivery_state: 'SENT' },
                },
            ],
            expected: { needs_merchant_reply: false, needs_merchant_reply_reason: null, ai_is_replying: false },
        },
        {
            name: 'DRAFT waiting',
            mode: 'DRAFT',
            messages: [customerMessage, {
                ...draftMessage,
                delivery_state: 'DRAFT_READY',
                delivery_source: 'AI_DRAFT',
                metadata: {
                    delivered: false,
                    delivery_state: 'DRAFT_READY',
                    suggestion_visibility: 'VISIBLE_DRAFT_REVIEW',
                },
            }],
            expected: { needs_merchant_reply: true, needs_merchant_reply_reason: 'DRAFT_REVIEW_REQUIRED', ai_is_replying: false },
        },
        {
            name: 'AUTO processing',
            mode: 'AUTO',
            messages: [
                customerMessage,
                {
                    id: 'processing-ai',
                    conversation_id: 'conversation-1',
                    sender: 'ai',
                    created_at: new Date('2026-09-04T10:01:00Z'),
                    delivery_state: 'SEND_PENDING',
                    delivery_source: 'AUTO',
                    metadata: {
                        delivery_state: 'SEND_PENDING',
                        suggestion_visibility: 'HIDDEN_AUTO_PROCESSING',
                    },
                },
            ],
            expected: { needs_merchant_reply: false, needs_merchant_reply_reason: null, ai_is_replying: true },
        },
        {
            name: 'AUTO failure',
            mode: 'AUTO',
            messages: [
                customerMessage,
                {
                    id: 'failed-ai',
                    conversation_id: 'conversation-1',
                    sender: 'ai',
                    created_at: new Date('2026-09-04T10:01:00Z'),
                    delivery_state: 'FAILED',
                    metadata: {
                        delivery_state: 'FAILED',
                        held_reason: 'provider_send_failed',
                        suggestion_visibility: 'VISIBLE_HITL_REVIEW',
                    },
                },
            ],
            expected: { needs_merchant_reply: true, needs_merchant_reply_reason: 'AI_FAILED', ai_is_replying: false },
        },
    ])('projects $name independently of unread state', async ({ mode, messages, expected }) => {
        const row = {
            id: 'conversation-1',
            customer_id: 'customer-1',
            channel: 'messenger',
            status: 'active',
            hitl: false,
            metadata: { unreadCount: 0 },
            customer: null,
            metaChannel: null,
            message: null,
        };
        mockConversationModel.findAndCountAll = jest.fn().mockResolvedValue({ rows: [row], count: 1 });
        getEffectiveAiReplyMode.mockResolvedValue(mode);
        mockMessageModel.findAll.mockResolvedValue(messages);

        const result = await conversationService.getConversations('shop-a');

        expect(result.conversations[0]).toEqual(expect.objectContaining(expected));
    });
});
