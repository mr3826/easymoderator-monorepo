'use strict';

const mockConversation = {
    findOne: jest.fn(),
    findByPk: jest.fn(),
};
const mockMessage = {
    create: jest.fn(),
};
const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockSequelize = {
    getDialect: jest.fn(() => 'postgres'),
    transaction: jest.fn(async (callback) => callback(mockTransaction)),
};

jest.mock('../conversation.entity', () => ({
    Conversation: mockConversation,
    Message: mockMessage,
}));
jest.mock('../../customer/customer.entity', () => ({}));
jest.mock('../../order/order-session-standalone.service', () => ({
    getActiveSession: jest.fn(),
}));
jest.mock('../../shop/ai-reply-mode', () => ({
    normalizeAiReplyMode: jest.fn((mode) => mode),
}));
jest.mock('../../../utils/database/database-setup', () => ({ sequelize: mockSequelize }));

const ConversationStateService = require('../conversation-state-standalone.service');

const boundary = new Date(Date.now() - 1_000).toISOString();

beforeEach(() => {
    jest.clearAllMocks();
    mockMessage.create.mockImplementation(async (attributes) => ({
        ...attributes,
        id: 'candidate-1',
    }));
});

describe('ConversationStateService Resume boundary', () => {
    it('terminalizes a late pre-Resume candidate inside the persistence transaction', async () => {
        const conversation = {
            id: 'conversation-1',
            metadata: { ai_resume_boundary_at: boundary },
            update: jest.fn(async (updates) => Object.assign(conversation, updates)),
        };
        mockConversation.findOne.mockResolvedValue(conversation);

        const result = await ConversationStateService.storeAIResponse(
            'conversation-1',
            'stale generated reply',
            {
                logical_turn_id: 'burst:old-customer',
                turn_started_at: new Date(Date.now() - 2_000).toISOString(),
                delivery_state: 'HELD',
                delivery_source: 'HITL_ESCALATION',
                suggestion_visibility: 'VISIBLE_HITL_REVIEW',
            },
        );

        expect(mockMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({
                delivery_state: 'DISMISSED',
                delivery_source: 'HITL_ESCALATION',
                metadata: expect.objectContaining({
                    delivery_state: 'DISMISSED',
                    delivery_status: 'dismissed',
                    suggestion_visibility: 'HIDDEN_DISMISSED',
                    held_reason: 'resume_obsolete',
                    dismissed_by_resume: true,
                }),
            }),
            { transaction: mockTransaction },
        );
        expect(result.message.delivery_state).toBe('DISMISSED');
        expect(mockSequelize.transaction).toHaveBeenCalledTimes(1);
    });

    it('allows a genuinely new post-Resume turn to remain eligible', async () => {
        const conversation = {
            id: 'conversation-1',
            metadata: { ai_resume_boundary_at: boundary },
            update: jest.fn(async (updates) => Object.assign(conversation, updates)),
        };
        mockConversation.findOne.mockResolvedValue(conversation);

        const result = await ConversationStateService.storeAIResponse(
            'conversation-1',
            'new generated reply',
            {
                logical_turn_id: 'burst:new-customer',
                turn_started_at: new Date(Date.now() + 1_000).toISOString(),
                delivery_state: 'DRAFT_READY',
                delivery_source: 'AI_DRAFT',
                suggestion_visibility: 'VISIBLE_DRAFT_REVIEW',
            },
        );

        expect(mockMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({
                delivery_state: 'DRAFT_READY',
                metadata: expect.objectContaining({
                    logical_turn_id: 'burst:new-customer',
                    delivery_state: 'DRAFT_READY',
                    suggestion_visibility: 'VISIBLE_DRAFT_REVIEW',
                }),
            }),
            { transaction: mockTransaction },
        );
        expect(result.message.delivery_state).toBe('DRAFT_READY');
    });

    it('fails closed when a candidate has no durable turn start after Resume', async () => {
        const conversation = {
            id: 'conversation-1',
            metadata: { ai_resume_boundary_at: boundary },
            update: jest.fn(),
        };
        mockConversation.findOne.mockResolvedValue(conversation);

        await expect(ConversationStateService.storeAIResponse(
            'conversation-1',
            'unanchored reply',
            {
                logical_turn_id: 'unknown-turn',
                delivery_state: 'HELD',
                delivery_source: 'AUTO',
                suggestion_visibility: 'VISIBLE_HITL_REVIEW',
            },
        )).rejects.toMatchObject({ code: 'RESUME_BOUNDARY_TURN_START_REQUIRED' });
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    it('merges shadow state from a locked row without erasing the Resume boundary', async () => {
        const conversation = {
            id: 'conversation-1',
            metadata: { ai_resume_boundary_at: boundary },
            update: jest.fn(async (updates) => Object.assign(conversation, updates)),
        };
        mockConversation.findOne.mockResolvedValue(conversation);

        await ConversationStateService.updateConversationState('conversation-1', {
            intent: 'GENERAL_INQUIRY',
            language: 'en',
            confidence: 0.9,
        });

        expect(conversation.update).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({
                    ai_resume_boundary_at: boundary,
                    last_intent: 'GENERAL_INQUIRY',
                }),
            }),
            { transaction: mockTransaction },
        );
    });

    it('fails closed when the persisted Resume boundary is malformed', async () => {
        mockConversation.findOne.mockResolvedValue({
            id: 'conversation-1',
            metadata: { ai_resume_boundary_at: '0' },
            update: jest.fn(),
        });

        await expect(ConversationStateService.storeAIResponse(
            'conversation-1',
            'uncertain reply',
            {
                logical_turn_id: 'turn-1',
                turn_started_at: new Date().toISOString(),
                delivery_state: 'HELD',
                delivery_source: 'AUTO',
            },
        )).rejects.toMatchObject({ code: 'RESUME_BOUNDARY_INVALID' });
        expect(mockMessage.create).not.toHaveBeenCalled();
    });
});
