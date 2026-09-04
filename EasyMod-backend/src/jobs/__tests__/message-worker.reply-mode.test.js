'use strict';

process.env.NODE_ENV = 'test';

const mockChannel = {
    id: 'channel-1',
    shop_id: 'shop-1',
    platform: 'facebook',
    status: 'CONNECTED',
    meta_asset_id: 'page-1',
};

const mockGetShopAiSettings = jest.fn();
const mockGetChannelSettings = jest.fn();
const mockCacheGet = jest.fn(async () => null);
const mockFindUniqueChannel = jest.fn(async () => mockChannel);
const mockFindChannelById = jest.fn(async () => mockChannel);
const mockFindChannelByAsset = jest.fn(async () => null);
const mockEvaluateOutbound = jest.fn();
const mockSendMessage = jest.fn();
const mockGetProvider = jest.fn(() => ({ sendMessage: mockSendMessage }));
const mockProcessNewIntent = jest.fn();
const mockHandleOrderFlow = jest.fn();
const mockHasPurchaseIntent = jest.fn();
const mockConversationFindOne = jest.fn();
const mockMessageFindAll = jest.fn();
const mockMessageCount = jest.fn();
const mockStoreAIResponse = jest.fn();
const mockStoredMessageUpdate = jest.fn();
const mockUpdateConversationState = jest.fn();
const mockSubscriptionFindOne = jest.fn();
const mockRecoveryStartTurn = jest.fn();
const mockRecoveryTransition = jest.fn();

jest.mock('bullmq', () => ({
    Worker: jest.fn(),
    Queue: jest.fn(() => ({ add: jest.fn() })),
    UnrecoverableError: class UnrecoverableError extends Error {},
}));
jest.mock('src/jobs/message-queue', () => ({ connection: {} }));
jest.mock('src/config/redis', () => ({
    cacheRedis: {
        get: mockCacheGet,
        set: jest.fn(async () => 'OK'),
        setex: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
    },
}));
jest.mock('src/utils/ops-alert', () => ({ opsAlert: jest.fn(async () => {}) }));
jest.mock('src/utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: { findOne: mockConversationFindOne },
    Message: { findAll: mockMessageFindAll, count: mockMessageCount },
}));
jest.mock('src/modules/conversation/conversation-state-standalone.service', () => ({
    detectLanguage: jest.fn(() => 'en'),
    extractEntities: jest.fn(() => ({})),
    storeAIResponse: mockStoreAIResponse,
    updateConversationState: mockUpdateConversationState,
}));
jest.mock('src/modules/channel-providers/provider.registry', () => ({ getProvider: mockGetProvider }));
jest.mock('src/modules/policy/policy.engine', () => ({ evaluateOutbound: mockEvaluateOutbound }));
jest.mock('src/modules/channel-providers/meta-channel.service', () => ({
    findConnectedById: mockFindChannelById,
    findByMetaAssetId: mockFindChannelByAsset,
    findUniqueConnectedByShopAndPlatform: mockFindUniqueChannel,
    getSettings: mockGetChannelSettings,
}));
jest.mock('src/modules/customer/customer.entity', () => ({
    findOne: jest.fn(async () => ({
        id: 'customer-1',
        shop_id: 'shop-1',
        channel_type: 'messenger',
        channel_user_id: 'recipient-1',
    })),
}));
jest.mock('src/modules/shop/shop.service', () => ({ getShopAiSettings: mockGetShopAiSettings }));
jest.mock('src/modules/entities', () => ({
    Shop: { findByPk: jest.fn(async () => ({ settings: {} })) },
    Subscription: { findOne: mockSubscriptionFindOne },
}));
jest.mock('src/modules/subscription/subscription.access', () => ({ isAiActive: jest.fn(() => true) }));
jest.mock('src/modules/ai/sentiment.service', () => ({
    analyzeSentiment: jest.fn(async () => ({ sentiment: 'neutral', score: 0, method: 'keyword' })),
    shouldAutoEscalate: jest.fn(() => false),
}));
jest.mock('src/modules/conversation/order-flow.service', () => ({
    handleOrderFlow: mockHandleOrderFlow,
    hasPurchaseIntent: mockHasPurchaseIntent,
}));
jest.mock('src/modules/conversation/ai-chatbot.controller', () => ({ processNewIntent: mockProcessNewIntent }));
jest.mock('src/modules/conversation/human-handoff.service', () => ({ escalateToHuman: jest.fn(async () => {}) }));
jest.mock('src/modules/knowledge/knowledge-gap-capture.service', () => ({ recordKnowledgeGap: jest.fn(async () => {}) }));
jest.mock('src/modules/analytics/growth-metrics.service', () => ({ recordActivation: jest.fn(() => Promise.resolve()) }));
jest.mock('src/modules/analytics/funnel-events.service', () => ({ recordFunnelEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('src/modules/shop/ai-messaging', () => ({ buildGreeting: jest.fn(() => '') }));
jest.mock('src/modules/shop/shop.entity', () => ({ findByPk: jest.fn(async () => ({ name: 'Test shop', settings: {} })) }));
jest.mock('src/modules/ai/recovery/turn-recovery.service', () => ({
    startTurn: mockRecoveryStartTurn,
    transition: mockRecoveryTransition,
    isHoldingSuppressed: jest.fn(() => false),
    isHardTimeoutSuppressed: jest.fn(() => false),
}));
jest.mock('src/modules/order/order-session-standalone.service', () => ({
    getActiveSession: jest.fn(async () => null),
}));
jest.mock('src/modules/ai/intent/stage2-rules', () => ({
    classify: jest.fn(() => ({
        intentId: 'GENERAL_INQUIRY',
        domain: 'CONVERSATION',
        slots: {},
        confidence: 1,
        source: 'RULE',
        matchedRule: 'test',
    })),
}));
jest.mock('src/modules/ai/contracts/intent.contract', () => ({
    createIntentRecord: jest.fn((input) => ({ ...input })),
}));
jest.mock('src/modules/ai/grounding', () => ({
    GroundingDecision: { SEND: 'SEND', SUPPRESS: 'SUPPRESS', SAFE_FALLBACK: 'SAFE_FALLBACK' },
    ReasonCode: { GROUNDED: 'GROUNDED', RETRIEVAL_FAILED: 'RETRIEVAL_FAILED' },
    emptyEvidence: jest.fn(() => ({
        productStatus: 'NO_CANDIDATE',
        mediaStatus: 'NOT_REQUESTED',
        mediaProductId: null,
        verifiedProducts: [],
        knowledgeIds: [],
    })),
    evaluateCandidate: jest.fn(({ candidate }) => ({
        decision: 'SEND',
        reasonCode: 'GROUNDED',
        text: candidate,
        attachments: [],
        violations: [],
    })),
    logGroundingDecision: jest.fn(),
    isModelGenerated: jest.fn(() => false),
}));

const { processMessageJob } = require('src/jobs/message-worker');

const makeJob = (overrides = {}) => ({
    id: 'job-1',
    data: {
        shopId: 'shop-1',
        conversationId: 'conv-1',
        messageId: 'message-1',
        externalId: 'external-1',
        message: 'What is the price?',
        platform: 'facebook',
        recipientId: 'recipient-1',
        senderInfo: {},
        ...overrides,
    },
    moveToDelayed: jest.fn(),
    token: 'job-token',
});

const shopSettings = (automation_mode = 'AUTO') => ({
    automation_mode,
    confidence_threshold: 75,
    staticConfigAvailable: { DELIVERY_POLICY: false, DELIVERY_CHARGE: false },
});

const channelSettings = {
    automation_mode: 'AI_ACTIVE',
    ai_auto_reply: true,
    business_hours: null,
    confidence_threshold_send: 0.75,
    confidence_threshold_suggest: 0.5,
    allow_order_creation: true,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockChannel.status = 'CONNECTED';
    mockCacheGet.mockReset().mockResolvedValue(null);
    mockConversationFindOne.mockResolvedValue({ id: 'conv-1', hitl: false, status: 'open', metadata: {} });
    mockMessageFindAll.mockResolvedValue([]);
    mockMessageCount.mockResolvedValue(0);
    mockGetShopAiSettings.mockReset().mockResolvedValue(shopSettings());
    mockGetChannelSettings.mockReset().mockResolvedValue({ ...channelSettings });
    mockSubscriptionFindOne.mockResolvedValue({ status: 'active' });
    mockRecoveryStartTurn.mockImplementation(async ({ traceId }) => ({
        turn: {
            trace_id: traceId,
            turn_started_at: new Date(),
            state: 'RECEIVED',
        },
    }));
    mockRecoveryTransition.mockResolvedValue(undefined);
    mockHandleOrderFlow.mockResolvedValue({ handled: false });
    mockHasPurchaseIntent.mockReturnValue(false);
    mockProcessNewIntent.mockResolvedValue({
        response: 'candidate response',
        confidence: 0.95,
        source: 'llm',
        grounding: {
            productStatus: 'NO_CANDIDATE',
            mediaStatus: 'NOT_REQUESTED',
            mediaProductId: null,
            verifiedProducts: [],
            knowledgeIds: [],
        },
        attachments: [],
    });
    mockEvaluateOutbound.mockReset().mockResolvedValue({ allow: true, decisionId: 'policy-1', transform: null });
    mockSendMessage.mockReset().mockResolvedValue({ providerMessageId: 'provider-1' });
    mockStoreAIResponse.mockImplementation(async (_conversationId, content) => ({
        message: {
            id: 'ai-1',
            content,
            metadata: {},
            update: mockStoredMessageUpdate,
        },
    }));
});

test('MANUAL business mode skips before any LLM or outbound policy work', async () => {
    mockGetShopAiSettings.mockResolvedValueOnce(shopSettings('MANUAL'));

    const result = await processMessageJob(makeJob());

    expect(result).toEqual(expect.objectContaining({ skipped: true, reason: 'manual_mode' }));
    expect(mockProcessNewIntent).not.toHaveBeenCalled();
    expect(mockHandleOrderFlow).not.toHaveBeenCalled();
    expect(mockEvaluateOutbound).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
});

test('an unknown business mode fails closed as MANUAL before the LLM', async () => {
    mockGetShopAiSettings.mockResolvedValueOnce(shopSettings('GARBAGE'));

    const result = await processMessageJob(makeJob());

    expect(result).toEqual(expect.objectContaining({ skipped: true, reason: 'manual_mode' }));
    expect(mockProcessNewIntent).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
});

test('DRAFT stores a reviewable candidate and never calls the provider', async () => {
    mockGetShopAiSettings.mockResolvedValue(shopSettings('DRAFT'));
    mockEvaluateOutbound.mockResolvedValueOnce({ allow: false, reason: 'DRAFT_MODE' });

    const result = await processMessageJob(makeJob());

    expect(result).toEqual(expect.objectContaining({ sent: false }));
    expect(mockProcessNewIntent).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockStoreAIResponse).toHaveBeenCalledWith(
        'conv-1',
        'candidate response',
        expect.objectContaining({
            delivery_state: 'DRAFT_READY',
            suggestion_visibility: 'VISIBLE_DRAFT_REVIEW',
        }),
    );
    expect(mockStoredMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        delivery_state: 'DRAFT_READY',
        metadata: expect.objectContaining({
            delivered: false,
            delivery_state: 'DRAFT_READY',
            suggestion_visibility: 'VISIBLE_DRAFT_REVIEW',
        }),
    }));
});

test('Page automation_mode and ai_auto_reply cannot override an AUTO business', async () => {
    mockGetChannelSettings.mockResolvedValue({
        ...channelSettings,
        automation_mode: 'MANUAL',
        ai_auto_reply: false,
        purpose_label: 'legacy page value',
    });

    const result = await processMessageJob(makeJob());

    expect(result.sent).toBe(true);
    expect(mockProcessNewIntent).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockEvaluateOutbound).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
        settings: expect.objectContaining({
            automation_mode: 'AUTO',
            purpose_label: 'legacy page value',
        }),
    }));
    expect(mockStoredMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        delivery_state: 'SENT',
        provider_message_id: 'provider-1',
        metadata: expect.objectContaining({
            delivered: true,
            delivery_state: 'SENT',
            suggestion_visibility: 'HIDDEN_SENT',
            provider_message_id: 'provider-1',
        }),
    }));
});

test('a channel that is no longer CONNECTED is blocked before the LLM', async () => {
    mockGetChannelSettings.mockImplementationOnce(async () => {
        mockChannel.status = 'DISCONNECTED';
        return { ...channelSettings, ai_auto_reply: true };
    });

    const result = await processMessageJob(makeJob());

    expect(result).toEqual({ skipped: true, reason: 'channel_disconnected' });
    expect(mockProcessNewIntent).not.toHaveBeenCalled();
    expect(mockEvaluateOutbound).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
});

test('an AUTO to MANUAL flip after Guard 4 holds the generated text and sends nothing', async () => {
    mockGetShopAiSettings
        .mockResolvedValueOnce(shopSettings('AUTO'))
        .mockResolvedValueOnce(shopSettings('MANUAL'));

    const result = await processMessageJob(makeJob());

    expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'mode_changed' }));
    expect(mockProcessNewIntent).toHaveBeenCalledTimes(1);
    expect(mockStoreAIResponse).toHaveBeenCalledWith(
        'conv-1',
        'candidate response',
        expect.objectContaining({ automation_mode: 'AUTO' }),
    );
    expect(mockStoredMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ delivered: false, held_reason: 'mode_changed', delivery_state: 'HELD' }),
        delivery_state: 'HELD',
    }));
    expect(mockEvaluateOutbound).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
});

test('a late human pause suppresses an in-flight AUTO send', async () => {
    let pauseReads = 0;
    mockCacheGet.mockImplementation(async (key) => {
        if (key !== 'ai:pause:conv-1') return null;
        pauseReads += 1;
        return pauseReads >= 2 ? '1' : null;
    });

    const result = await processMessageJob(makeJob());

    expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'ai_paused' }));
    expect(mockProcessNewIntent).toHaveBeenCalledTimes(1);
    expect(mockEvaluateOutbound).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockStoredMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ delivered: false, held_reason: 'ai_paused', delivery_state: 'HELD' }),
        delivery_state: 'HELD',
    }));
});

test('a mode change during policy evaluation is rechecked before provider delivery', async () => {
    mockGetShopAiSettings
        .mockResolvedValueOnce(shopSettings('AUTO'))
        .mockResolvedValueOnce(shopSettings('AUTO'))
        .mockResolvedValueOnce(shopSettings('MANUAL'));

    const result = await processMessageJob(makeJob());

    expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'mode_changed' }));
    expect(mockEvaluateOutbound).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockStoredMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ delivered: false, held_reason: 'mode_changed', delivery_state: 'HELD' }),
        delivery_state: 'HELD',
    }));
});
