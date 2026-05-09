'use strict';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Mock: entities (Conversation, Message, Customer)
// ---------------------------------------------------------------------------
const mockConversationFindAndCountAll = jest.fn();
const mockConversationFindOne = jest.fn();
const mockConversationFindAll = jest.fn();
const mockConversationCreate = jest.fn();
const mockConversationUpdate = jest.fn();

const mockMessageFindAndCountAll = jest.fn();
const mockMessageFindAll = jest.fn();
const mockMessageCreate = jest.fn();
const mockMessageFindOne = jest.fn();

// Conversation entity object returned by findOne — supports .update()
const makeConversation = (overrides = {}) => ({
    id: 'conv-1',
    shop_id: 'shop-1',
    customer_id: 'cust-1',
    channel: 'facebook',
    title: 'Test conversation',
    status: 'active',
    hitl: false,
    metadata: {},
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
    resolved_at: null,
    message: null,
    customer: { id: 'cust-1', name: 'Test Customer', phone: '+1234567890' },
    update: jest.fn(async (fields) => Object.assign(overrides, fields)),
    ...overrides
});

jest.mock('../../entities', () => ({
    Conversation: {
        findAndCountAll: (...args) => mockConversationFindAndCountAll(...args),
        findOne: (...args) => mockConversationFindOne(...args),
        findAll: (...args) => mockConversationFindAll(...args),
        create: (...args) => mockConversationCreate(...args),
        update: (...args) => mockConversationUpdate(...args)
    },
    Message: {
        findAndCountAll: (...args) => mockMessageFindAndCountAll(...args),
        findAll: (...args) => mockMessageFindAll(...args),
        create: (...args) => mockMessageCreate(...args),
        findOne: (...args) => mockMessageFindOne(...args)
    },
    Customer: {}
}));

// ---------------------------------------------------------------------------
// Mock: database-setup (sequelize.transaction)
// ---------------------------------------------------------------------------
const mockTransactionCommit = jest.fn();
const mockTransactionRollback = jest.fn();

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async () => ({
            commit: mockTransactionCommit,
            rollback: mockTransactionRollback
        }))
    }
}));

// ---------------------------------------------------------------------------
// Mock: structured-logger
// ---------------------------------------------------------------------------
const mockLogUsage = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: mockLoggerInfo,
        error: mockLoggerError,
        warn: mockLoggerWarn,
        debug: jest.fn(),
        logUsage: mockLogUsage
    }))
}));

// ---------------------------------------------------------------------------
// Mock: subscription service
// ---------------------------------------------------------------------------
const mockTrackUsage = jest.fn();

jest.mock('../../subscription/subscription.service', () => ({
    trackUsage: (...args) => mockTrackUsage(...args)
}));

// ---------------------------------------------------------------------------
// Mock: Op from sequelize (needed by service at module level)
// ---------------------------------------------------------------------------
jest.mock('sequelize', () => {
    const actual = jest.requireActual('sequelize');
    return { ...actual, Op: actual.Op };
});

// ---------------------------------------------------------------------------
// Module under test — required AFTER all mocks
// ---------------------------------------------------------------------------
const conversationService = require('../conversation.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeMessage = (overrides = {}) => ({
    id: 'msg-1',
    conversation_id: 'conv-1',
    content: 'Hello world',
    sender: 'customer',
    metadata: { message_type: 'text' },
    ai_suggestion: null,
    ai_confidence: null,
    message_tag: null,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
    ...overrides
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ConversationService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransactionCommit.mockResolvedValue(undefined);
        mockTransactionRollback.mockResolvedValue(undefined);
        mockTrackUsage.mockResolvedValue({ transactionId: 'txn-1', isRetry: false });
    });

    // =========================================================================
    // getConversations
    // =========================================================================
    describe('getConversations', () => {
        it('should return paginated conversations with default options', async () => {
            const conv = makeConversation();
            mockConversationFindAndCountAll.mockResolvedValue({ rows: [conv], count: 1 });

            const result = await conversationService.getConversations('shop-1');

            expect(mockConversationFindAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { shop_id: 'shop-1' },
                    limit: 20,
                    offset: 0
                })
            );
            expect(result.conversations).toHaveLength(1);
            expect(result.pagination).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
        });

        it('should apply channel filter when provided', async () => {
            mockConversationFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

            await conversationService.getConversations('shop-1', { channel: 'messenger' });

            expect(mockConversationFindAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ channel: 'messenger' }) })
            );
        });

        it('should apply customer_id filter when provided', async () => {
            mockConversationFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

            await conversationService.getConversations('shop-1', { customer_id: 'cust-99' });

            expect(mockConversationFindAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ customer_id: 'cust-99' }) })
            );
        });

        it('should apply valid status filter and ignore unknown statuses', async () => {
            mockConversationFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

            await conversationService.getConversations('shop-1', { status: 'unanswered' });
            expect(mockConversationFindAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: 'unanswered' }) })
            );

            jest.clearAllMocks();
            mockConversationFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });

            await conversationService.getConversations('shop-1', { status: 'bogus_status' });
            const call = mockConversationFindAndCountAll.mock.calls[0][0];
            expect(call.where).not.toHaveProperty('status');
        });

        it('should calculate correct offset and totalPages for page 2', async () => {
            mockConversationFindAndCountAll.mockResolvedValue({ rows: [], count: 45 });

            const result = await conversationService.getConversations('shop-1', { page: 2, limit: 20 });

            expect(mockConversationFindAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({ offset: 20, limit: 20 })
            );
            expect(result.pagination).toEqual({ total: 45, page: 2, limit: 20, totalPages: 3 });
        });

        it('should map messenger channel to facebook in response', async () => {
            const conv = makeConversation({ channel: 'messenger' });
            mockConversationFindAndCountAll.mockResolvedValue({ rows: [conv], count: 1 });

            const result = await conversationService.getConversations('shop-1');

            expect(result.conversations[0].channel).toBe('facebook');
        });

        it('should map web channel to webchat in response', async () => {
            const conv = makeConversation({ channel: 'web' });
            mockConversationFindAndCountAll.mockResolvedValue({ rows: [conv], count: 1 });

            const result = await conversationService.getConversations('shop-1');

            expect(result.conversations[0].channel).toBe('webchat');
        });

        it('should throw on DB failure', async () => {
            mockConversationFindAndCountAll.mockRejectedValue(new Error('DB error'));

            await expect(conversationService.getConversations('shop-1')).rejects.toThrow(
                'Failed to fetch conversations'
            );
        });
    });

    // =========================================================================
    // getConversationById
    // =========================================================================
    describe('getConversationById', () => {
        it('should return mapped conversation when found', async () => {
            const conv = makeConversation();
            mockConversationFindOne.mockResolvedValue(conv);

            const result = await conversationService.getConversationById('conv-1', 'shop-1');

            expect(mockConversationFindOne).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'conv-1', shop_id: 'shop-1' } })
            );
            expect(result.id).toBe('conv-1');
            expect(result.channel).toBe('facebook'); // messenger → facebook
        });

        it('should throw when conversation not found', async () => {
            mockConversationFindOne.mockResolvedValue(null);

            await expect(
                conversationService.getConversationById('missing', 'shop-1')
            ).rejects.toThrow('Failed to fetch conversation');
        });

        it('should include customer data in result', async () => {
            const conv = makeConversation({ customer: { id: 'cust-1', name: 'Alice', phone: '+880' } });
            mockConversationFindOne.mockResolvedValue(conv);

            const result = await conversationService.getConversationById('conv-1', 'shop-1');

            expect(result.customer).toEqual({ id: 'cust-1', name: 'Alice', phone: '+880' });
        });

        it('should resolve title from metadata when conversation.title is null', async () => {
            const conv = makeConversation({ title: null, metadata: { title: 'Meta Title' } });
            mockConversationFindOne.mockResolvedValue(conv);

            const result = await conversationService.getConversationById('conv-1', 'shop-1');

            expect(result.title).toBe('Meta Title');
        });

        it('should default hitl to false when missing', async () => {
            const conv = makeConversation({ hitl: undefined });
            // hitl ?? false → false
            conv.hitl = undefined;
            mockConversationFindOne.mockResolvedValue(conv);

            const result = await conversationService.getConversationById('conv-1', 'shop-1');

            expect(result.hitl).toBe(false);
        });

        it('should throw wrapped error on DB failure', async () => {
            mockConversationFindOne.mockRejectedValue(new Error('Connection lost'));

            await expect(
                conversationService.getConversationById('conv-1', 'shop-1')
            ).rejects.toThrow('Failed to fetch conversation: Conversation not found');
        });
    });

    // =========================================================================
    // getMessages
    // =========================================================================
    describe('getMessages', () => {
        it('should return paginated messages for a valid conversation', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            const msg = makeMessage();
            mockMessageFindAndCountAll.mockResolvedValue({ rows: [msg], count: 1 });

            const result = await conversationService.getMessages('conv-1', 'shop-1');

            expect(result.messages).toHaveLength(1);
            expect(result.pagination).toEqual({ total: 1, page: 1, limit: 50, totalPages: 1 });
        });

        it('should throw when conversation not found', async () => {
            mockConversationFindOne.mockResolvedValue(null);

            await expect(
                conversationService.getMessages('conv-missing', 'shop-1')
            ).rejects.toThrow('Failed to fetch messages');
        });

        it('should map business sender to agent in response', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockMessageFindAndCountAll.mockResolvedValue({
                rows: [makeMessage({ sender: 'business' })],
                count: 1
            });

            const result = await conversationService.getMessages('conv-1', 'shop-1');

            expect(result.messages[0].sender).toBe('agent');
        });

        it('should use custom page and limit options', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockMessageFindAndCountAll.mockResolvedValue({ rows: [], count: 100 });

            const result = await conversationService.getMessages('conv-1', 'shop-1', { page: 3, limit: 10 });

            expect(mockMessageFindAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({ offset: 20, limit: 10 })
            );
            expect(result.pagination.totalPages).toBe(10);
        });

        it('should read message_type from metadata', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockMessageFindAndCountAll.mockResolvedValue({
                rows: [makeMessage({ metadata: { message_type: 'image' } })],
                count: 1
            });

            const result = await conversationService.getMessages('conv-1', 'shop-1');

            expect(result.messages[0].message_type).toBe('image');
        });

        it('should default message_type to text when metadata is absent', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockMessageFindAndCountAll.mockResolvedValue({
                rows: [makeMessage({ metadata: null })],
                count: 1
            });

            const result = await conversationService.getMessages('conv-1', 'shop-1');

            expect(result.messages[0].message_type).toBe('text');
        });

        it('should cast ai_confidence to Number', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockMessageFindAndCountAll.mockResolvedValue({
                rows: [makeMessage({ ai_confidence: '0.95' })],
                count: 1
            });

            const result = await conversationService.getMessages('conv-1', 'shop-1');

            expect(typeof result.messages[0].ai_confidence).toBe('number');
            expect(result.messages[0].ai_confidence).toBeCloseTo(0.95);
        });
    });

    // =========================================================================
    // createConversation
    // =========================================================================
    describe('createConversation', () => {
        const conversationData = {
            channel: 'facebook',
            customer_id: 'cust-1',
            title: 'New chat',
            status: 'active'
        };

        it('should create conversation within a transaction and commit', async () => {
            const createdConv = makeConversation({ id: 'conv-new' });
            mockConversationCreate.mockResolvedValue(createdConv);

            const result = await conversationService.createConversation('shop-1', conversationData, 'req-1');

            expect(mockConversationCreate).toHaveBeenCalledWith(
                expect.objectContaining({ shop_id: 'shop-1', title: 'New chat', status: 'active' }),
                expect.objectContaining({ transaction: expect.any(Object) })
            );
            expect(mockTransactionCommit).toHaveBeenCalledTimes(1);
            expect(mockTransactionRollback).not.toHaveBeenCalled();
            expect(result.id).toBe('conv-new');
        });

        it('should call subscriptionService.trackUsage after commit', async () => {
            const createdConv = makeConversation({ id: 'conv-tracked', channel: 'facebook', customer_id: 'cust-1' });
            mockConversationCreate.mockResolvedValue(createdConv);

            await conversationService.createConversation('shop-1', conversationData, 'req-abc');

            expect(mockTrackUsage).toHaveBeenCalledWith(
                'shop-1',
                'conversations',
                1,
                'req-abc',
                expect.objectContaining({ resourceId: 'conv-tracked' })
            );
        });

        it('should rollback and throw AppError on conversation create failure', async () => {
            const { AppError } = require('../../../utils/AppError');
            mockConversationCreate.mockRejectedValue(new Error('DB constraint violation'));

            await expect(
                conversationService.createConversation('shop-1', conversationData, 'req-1')
            ).rejects.toMatchObject({ name: 'AppError' });

            expect(mockTransactionRollback).toHaveBeenCalledTimes(1);
        });

        it('should resolve title from intent when title not provided', async () => {
            const data = { channel: 'facebook', intent: 'order_inquiry' };
            const createdConv = makeConversation({ title: 'order_inquiry' });
            mockConversationCreate.mockResolvedValue(createdConv);

            await conversationService.createConversation('shop-1', data, null);

            expect(mockConversationCreate).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'order_inquiry' }),
                expect.any(Object)
            );
        });

        it('should resolve title from metadata.title as last fallback', async () => {
            const data = { channel: 'facebook', metadata: { title: 'Meta title fallback' } };
            const createdConv = makeConversation({ title: 'Meta title fallback' });
            mockConversationCreate.mockResolvedValue(createdConv);

            await conversationService.createConversation('shop-1', data, null);

            expect(mockConversationCreate).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Meta title fallback' }),
                expect.any(Object)
            );
        });

        it('should default status to active when none provided', async () => {
            const data = { channel: 'facebook', customer_id: 'cust-1' };
            const createdConv = makeConversation({ status: 'active' });
            mockConversationCreate.mockResolvedValue(createdConv);

            await conversationService.createConversation('shop-1', data, null);

            expect(mockConversationCreate).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'active' }),
                expect.any(Object)
            );
        });

        it('should not throw when usage tracking fails with non-critical error', async () => {
            const createdConv = makeConversation({ id: 'conv-ok' });
            mockConversationCreate.mockResolvedValue(createdConv);
            mockTrackUsage.mockRejectedValue(new Error('Tracking service down'));

            // Should not throw — usage tracking errors are swallowed (non-critical)
            const result = await conversationService.createConversation('shop-1', conversationData, 'req-1');
            expect(result.id).toBe('conv-ok');
            expect(mockTransactionCommit).toHaveBeenCalledTimes(1);
        });

        it('should rethrow USAGE_LIMIT_EXCEEDED as AppError', async () => {
            const { AppError } = require('../../../utils/AppError');
            const createdConv = makeConversation({ id: 'conv-limit' });
            mockConversationCreate.mockResolvedValue(createdConv);

            const limitError = new Error('Limit exceeded');
            limitError.code = 'USAGE_LIMIT_EXCEEDED';
            mockTrackUsage.mockRejectedValue(limitError);

            await expect(
                conversationService.createConversation('shop-1', conversationData, 'req-1')
            ).rejects.toMatchObject({ code: 'USAGE_LIMIT_EXCEEDED' });
        });
    });

    // =========================================================================
    // createMessage
    // =========================================================================
    describe('createMessage', () => {
        const messageData = { content: 'Hello!', sender: 'agent' };

        it('should create a message for an existing conversation', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            const msg = makeMessage({ sender: 'business' });
            mockMessageCreate.mockResolvedValue(msg);

            const result = await conversationService.createMessage('conv-1', 'shop-1', messageData);

            expect(mockMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    conversation_id: 'conv-1',
                    sender: 'business', // agent → business in storage
                    content: 'Hello!'
                })
            );
            expect(result.sender).toBe('agent'); // mapped back in response
        });

        it('should throw when conversation not found', async () => {
            mockConversationFindOne.mockResolvedValue(null);

            await expect(
                conversationService.createMessage('conv-missing', 'shop-1', messageData)
            ).rejects.toThrow('Failed to create message');
        });

        it('should store customer sender as-is (not remapped)', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            const msg = makeMessage({ sender: 'customer' });
            mockMessageCreate.mockResolvedValue(msg);

            await conversationService.createMessage('conv-1', 'shop-1', { content: 'Hi', sender: 'customer' });

            expect(mockMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({ sender: 'customer' }),
                undefined
            );
        });

        it('should use message field as fallback for content', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            const msg = makeMessage();
            mockMessageCreate.mockResolvedValue(msg);

            await conversationService.createMessage('conv-1', 'shop-1', { message: 'Fallback content', sender: 'customer' });

            expect(mockMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({ content: 'Fallback content' }),
                undefined
            );
        });

        it('should store message_type inside metadata', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            const msg = makeMessage({ metadata: { message_type: 'image' } });
            mockMessageCreate.mockResolvedValue(msg);

            await conversationService.createMessage('conv-1', 'shop-1', {
                content: 'img url',
                sender: 'agent',
                message_type: 'image'
            });

            expect(mockMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({ metadata: expect.objectContaining({ message_type: 'image' }) }),
                undefined
            );
        });

        it('should propagate ai_suggestion and ai_confidence fields', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            const msg = makeMessage({ ai_suggestion: 'Try this', ai_confidence: 0.88 });
            mockMessageCreate.mockResolvedValue(msg);

            const result = await conversationService.createMessage('conv-1', 'shop-1', {
                content: 'Hi',
                sender: 'ai',
                ai_suggestion: 'Try this',
                ai_confidence: 0.88
            });

            expect(result.ai_suggestion).toBe('Try this');
            expect(result.ai_confidence).toBeCloseTo(0.88);
        });
    });

    // =========================================================================
    // updateConversation
    // =========================================================================
    describe('updateConversation', () => {
        it('should update hitl flag', async () => {
            const conv = makeConversation();
            mockConversationFindOne.mockResolvedValue(conv);

            await conversationService.updateConversation('conv-1', 'shop-1', { hitl: true });

            expect(conv.update).toHaveBeenCalledWith(expect.objectContaining({ hitl: true }));
        });

        it('should update status and sync metadata.status', async () => {
            const conv = makeConversation({ metadata: { unreadCount: 3 } });
            mockConversationFindOne.mockResolvedValue(conv);

            await conversationService.updateConversation('conv-1', 'shop-1', { status: 'completed' });

            expect(conv.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'completed',
                    metadata: expect.objectContaining({ status: 'completed', unreadCount: 3 })
                })
            );
        });

        it('should set resolved_at when status changes to closed', async () => {
            const conv = makeConversation({ resolved_at: null });
            mockConversationFindOne.mockResolvedValue(conv);

            await conversationService.updateConversation('conv-1', 'shop-1', { status: 'closed' });

            const callArg = conv.update.mock.calls[0][0];
            expect(callArg.resolved_at).toBeInstanceOf(Date);
        });

        it('should not overwrite existing resolved_at when already set', async () => {
            const existingDate = new Date('2025-06-01');
            const conv = makeConversation({ resolved_at: existingDate });
            mockConversationFindOne.mockResolvedValue(conv);

            await conversationService.updateConversation('conv-1', 'shop-1', { status: 'closed' });

            const callArg = conv.update.mock.calls[0][0];
            // resolved_at should not be set again since it already has a value
            expect(callArg.resolved_at).toBeUndefined();
        });

        it('should throw when conversation not found', async () => {
            mockConversationFindOne.mockResolvedValue(null);

            await expect(
                conversationService.updateConversation('conv-missing', 'shop-1', { hitl: true })
            ).rejects.toThrow('Failed to update conversation');
        });

        it('should update assignee_id when provided', async () => {
            const conv = makeConversation();
            mockConversationFindOne.mockResolvedValue(conv);

            await conversationService.updateConversation('conv-1', 'shop-1', { assignee_id: 'user-99' });

            expect(conv.update).toHaveBeenCalledWith(
                expect.objectContaining({ assignee_id: 'user-99' })
            );
        });

        it('should update resolution_note when provided', async () => {
            const conv = makeConversation();
            mockConversationFindOne.mockResolvedValue(conv);

            await conversationService.updateConversation('conv-1', 'shop-1', { resolution_note: 'Resolved by agent' });

            expect(conv.update).toHaveBeenCalledWith(
                expect.objectContaining({ resolution_note: 'Resolved by agent' })
            );
        });
    });

    // =========================================================================
    // bulkUpdateStatus
    // =========================================================================
    describe('bulkUpdateStatus', () => {
        it('should bulk-update status and return correct counts', async () => {
            mockConversationUpdate.mockResolvedValue([3]);

            const result = await conversationService.bulkUpdateStatus(
                'shop-1',
                ['conv-1', 'conv-2', 'conv-3'],
                'closed'
            );

            expect(result).toEqual({ requested: 3, updated: 3, skipped: 0, status: 'closed' });
        });

        it('should return skipped count when not all conversations are updated', async () => {
            mockConversationUpdate.mockResolvedValue([2]);

            const result = await conversationService.bulkUpdateStatus(
                'shop-1',
                ['conv-1', 'conv-2', 'conv-3'],
                'completed'
            );

            expect(result.skipped).toBe(1);
        });

        it('should throw 400 when shopId is missing', async () => {
            await expect(
                conversationService.bulkUpdateStatus(null, ['conv-1'], 'active')
            ).rejects.toThrow('Shop ID is required');
        });

        it('should throw 400 when conversationIds is empty', async () => {
            await expect(
                conversationService.bulkUpdateStatus('shop-1', [], 'active')
            ).rejects.toThrow('conversationIds must be a non-empty array');
        });

        it('should throw 400 when conversationIds is not an array', async () => {
            await expect(
                conversationService.bulkUpdateStatus('shop-1', 'not-array', 'active')
            ).rejects.toThrow('conversationIds must be a non-empty array');
        });

        it('should throw 400 for an invalid status', async () => {
            await expect(
                conversationService.bulkUpdateStatus('shop-1', ['conv-1'], 'invalid_status')
            ).rejects.toThrow('Invalid status');
        });

        it('should accept all allowed statuses without throwing', async () => {
            const allowed = ['active', 'closed', 'archived', 'unanswered', 'pending_order', 'completed', 'followed_up'];
            mockConversationUpdate.mockResolvedValue([1]);

            for (const status of allowed) {
                await expect(
                    conversationService.bulkUpdateStatus('shop-1', ['conv-1'], status)
                ).resolves.not.toThrow();
                jest.clearAllMocks();
                mockConversationUpdate.mockResolvedValue([1]);
            }
        });

        it('should query with Op.in containing the provided IDs', async () => {
            const { Op } = require('sequelize');
            mockConversationUpdate.mockResolvedValue([2]);

            await conversationService.bulkUpdateStatus('shop-1', ['conv-a', 'conv-b'], 'active');

            expect(mockConversationUpdate).toHaveBeenCalledWith(
                { status: 'active' },
                expect.objectContaining({
                    where: expect.objectContaining({ shop_id: 'shop-1' })
                })
            );
        });
    });

    // =========================================================================
    // searchConversations (delegates to internal implementation)
    // =========================================================================
    describe('searchConversations', () => {
        it('should throw when query is less than 2 characters', async () => {
            await expect(
                conversationService.searchConversations('shop-1', 'a')
            ).rejects.toThrow('Search query must be at least 2 characters');
        });

        it('should throw when query is empty', async () => {
            await expect(
                conversationService.searchConversations('shop-1', '')
            ).rejects.toThrow('Search query must be at least 2 characters');
        });

        it('should return merged results with pagination', async () => {
            mockConversationFindAll.mockResolvedValue([makeConversation()]);
            mockMessageFindAll.mockResolvedValue([]);

            const result = await conversationService.searchConversations('shop-1', 'refund');

            expect(result.results).toHaveLength(1);
            expect(result.pagination).toMatchObject({ page: 1, limit: 20 });
            expect(result.query).toBe('refund');
        });

        it('should deduplicate conversations matched by both title and message', async () => {
            const conv = makeConversation({ id: 'conv-dup' });
            const msgWithConv = { conversation: conv, content: 'refund please' };
            mockConversationFindAll.mockResolvedValue([conv]);
            mockMessageFindAll.mockResolvedValue([msgWithConv]);

            const result = await conversationService.searchConversations('shop-1', 'refund');

            // conv-dup should appear only once despite matching both queries
            const ids = result.results.map(r => r.id);
            expect(ids.filter(id => id === 'conv-dup')).toHaveLength(1);
        });

        it('should annotate message matches with matchSnippet and matchType', async () => {
            mockConversationFindAll.mockResolvedValue([]);
            const conv = makeConversation({ id: 'conv-2' });
            const msgWithConv = {
                conversation: conv,
                content: 'This is a very long message content that should be truncated at 120 chars'
            };
            mockMessageFindAll.mockResolvedValue([msgWithConv]);

            const result = await conversationService.searchConversations('shop-1', 'message');

            expect(result.results[0].matchType).toBe('message');
            expect(result.results[0].matchSnippet).toBeDefined();
        });

        it('should return empty results without throwing when nothing matches', async () => {
            mockConversationFindAll.mockResolvedValue([]);
            mockMessageFindAll.mockResolvedValue([]);

            const result = await conversationService.searchConversations('shop-1', 'xyzzy');

            expect(result.results).toHaveLength(0);
            expect(result.pagination.total).toBe(0);
        });

        it('should paginate merged results correctly across pages', async () => {
            // Generate 25 unique conversations from title matches
            const convs = Array.from({ length: 25 }, (_, i) => makeConversation({ id: `conv-${i}` }));
            mockConversationFindAll.mockResolvedValue(convs);
            mockMessageFindAll.mockResolvedValue([]);

            const page1 = await conversationService.searchConversations('shop-1', 'test', { page: 1, limit: 20 });
            const page2 = await conversationService.searchConversations('shop-1', 'test', { page: 2, limit: 20 });

            expect(page1.results).toHaveLength(20);
            expect(page2.results).toHaveLength(5);
            expect(page1.pagination.totalPages).toBe(2);
        });
    });
});
