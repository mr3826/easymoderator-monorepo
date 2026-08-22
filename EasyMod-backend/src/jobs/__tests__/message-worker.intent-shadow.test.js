'use strict';

process.env.NODE_ENV = 'test';

jest.mock('bullmq', () => ({
    Worker: jest.fn(),
    Queue: jest.fn(() => ({ add: jest.fn() })),
    UnrecoverableError: class UnrecoverableError extends Error {},
}));
jest.mock('src/jobs/message-queue', () => ({ connection: {} }));
jest.mock('src/config/redis', () => ({
    cacheRedis: {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        setex: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
    },
}));
jest.mock('src/utils/ops-alert', () => ({ opsAlert: jest.fn(async () => {}) }));
jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: { findOne: jest.fn(), findByPk: jest.fn() },
    Message: { findAll: jest.fn(async () => []), count: jest.fn(async () => 1) },
}));
const mockUpdateConversationState = jest.fn(async () => ({ success: true }));
jest.mock('src/modules/conversation/conversation-state-standalone.service', () => ({
    detectLanguage: jest.fn(() => 'bn'),
    extractEntities: jest.fn(() => ({ product_types: ['saree'] })),
    updateConversationState: mockUpdateConversationState,
    storeAIResponse: jest.fn(async (_c, content) => ({ message: { id: 'ai-1', content, metadata: {}, update: jest.fn() } })),
}));
const mockGetProvider = jest.fn(() => ({ sendMessage: jest.fn(async () => ({ providerMessageId: 'out-1' })) }));
jest.mock('src/modules/channel-providers/provider.registry', () => ({ getProvider: mockGetProvider }));
jest.mock('src/utils/sse-manager', () => ({ emit: jest.fn() }));
const mockEvaluateOutbound = jest.fn(async () => ({ allow: false, reason: 'DRAFT', decisionId: 'd-1' }));
jest.mock('src/modules/policy/policy.engine', () => ({ evaluateOutbound: mockEvaluateOutbound }));
jest.mock('src/modules/channel-providers/meta-channel.service', () => ({
    findByShopAndPlatform: jest.fn(async () => ({ id: 'ch-1', shop_id: 'shop-a' })),
    getSettings: jest.fn(async () => ({})),
}));
jest.mock('src/modules/channel-providers/meta-channel.entity', () => ({ findByPk: jest.fn(async () => null) }));
jest.mock('src/modules/customer/customer.entity', () => ({ findOne: jest.fn(async () => ({ id: 'cust-1' })) }));
jest.mock('src/modules/shop/shop.service', () => ({ getShopAiSettings: jest.fn(async () => ({ automation_mode: 'DRAFT', confidence_threshold: 75 })) }));
jest.mock('src/modules/entities', () => ({ Subscription: { findOne: jest.fn(async () => ({ status: 'active' })) } }));
jest.mock('src/modules/subscription/subscription.access', () => ({ isAiActive: jest.fn(() => true) }));
jest.mock('src/modules/ai/sentiment.service', () => ({
    analyzeSentiment: jest.fn(async () => ({ sentiment: 'neutral', score: 0, method: 'keyword' })),
    shouldAutoEscalate: jest.fn(() => false),
}));
const mockHandleOrderFlow = jest.fn(async () => ({ handled: false }));
const mockHasPurchaseIntent = jest.fn(() => false);
jest.mock('src/modules/conversation/order-flow.service', () => ({ handleOrderFlow: mockHandleOrderFlow, hasPurchaseIntent: mockHasPurchaseIntent }));
const mockProcessNewIntent = jest.fn(async () => ({ response: 'draft response', confidence: 0.9, sourceReferences: null }));
jest.mock('src/modules/conversation/ai-chatbot.controller', () => ({ processNewIntent: mockProcessNewIntent }));
jest.mock('src/modules/conversation/human-handoff.service', () => ({ escalateToHuman: jest.fn(async () => {}) }));
jest.mock('src/modules/notification/merchant-notification.service', () => ({ notifyShop: jest.fn(async () => ({ queued: true })) }));
jest.mock('src/modules/notification/notification-events', () => ({ NOTIFICATION_EVENTS: { AI_HITL: 'ai_hitl' } }));
jest.mock('src/modules/knowledge/knowledge-gap-capture.service', () => ({ recordKnowledgeGap: jest.fn(async () => {}) }));
jest.mock('src/modules/analytics/growth-metrics.service', () => ({ recordActivation: jest.fn(() => Promise.resolve()) }));
jest.mock('src/modules/analytics/funnel-events.service', () => ({ recordFunnelEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('src/modules/shop/ai-messaging', () => ({ buildGreeting: jest.fn(() => '') }));
jest.mock('src/modules/shop/shop.entity', () => ({ findByPk: jest.fn(async () => ({ name: 'Demo', settings: {} })) }));

const { processMessageJob } = require('src/jobs/message-worker');
const { Conversation } = require('src/modules/conversation/conversation.entity');

const job = (overrides = {}) => ({
    id: 'job-1',
    data: {
        shopId: 'shop-a',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        externalId: 'ext-1',
        message: 'red saree nibo',
        platform: 'facebook',
        recipientId: 'recipient-1',
        senderInfo: {},
        ...overrides,
    },
    moveToDelayed: jest.fn(),
    token: 'token-1',
});

beforeEach(() => {
    jest.clearAllMocks();
    Conversation.findOne.mockResolvedValue({ id: 'conv-1', hitl: false, status: 'active' });
    mockHasPurchaseIntent.mockReturnValue(false);
    mockHandleOrderFlow.mockResolvedValue({ handled: false });
    mockProcessNewIntent.mockResolvedValue({ response: 'draft response', confidence: 0.9, sourceReferences: null });
});

test('persists the shadow intent and confidence without changing live order-flow arguments', async () => {
    const currentJob = job({ message: 'red saree nibo' });
    const result = await processMessageJob(currentJob);

    expect(result.success).toBe(true);
    expect(mockUpdateConversationState).toHaveBeenCalledWith('conv-1', expect.objectContaining({
        intent: 'PURCHASE_INTENT_START',
        confidence: expect.any(Number),
        intentRecord: expect.objectContaining({ source: 'RULE', intentId: 'PURCHASE_INTENT_START' }),
    }));
    expect(mockHandleOrderFlow).toHaveBeenCalledWith(expect.objectContaining({
        shopId: 'shop-a',
        conversationId: 'conv-1',
        message: 'red saree nibo',
        entities: { product_types: ['saree'] },
        language: 'bn',
        imageUrls: [],
    }));
});

test('records an unsafe shadow divergence without creating an order session', async () => {
    mockHasPurchaseIntent.mockReturnValue(false);
    mockHandleOrderFlow.mockResolvedValue({ handled: false });

    await processMessageJob(job({ message: 'red saree nibo' }));

    expect(mockUpdateConversationState).toHaveBeenCalledWith('conv-1', expect.objectContaining({
        unsafeShadowActions: 1,
        shadowDivergence: expect.objectContaining({ proposedIntent: 'PURCHASE_INTENT_START' }),
    }));
    expect(mockHandleOrderFlow).toHaveBeenCalledTimes(1);
    await expect(mockHandleOrderFlow.mock.results[0].value).resolves.toEqual({ handled: false });
    expect(mockGetProvider).not.toHaveBeenCalled();
});
