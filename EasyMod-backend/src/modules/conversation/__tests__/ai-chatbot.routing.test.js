'use strict';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';

const mockConversationStateService = {
    ingestMessage: jest.fn(),
    detectLanguage: jest.fn(() => 'en'),
    extractEntities: jest.fn(() => ({})),
    updateConversationState: jest.fn(),
    storeAIResponse: jest.fn(),
};
const mockOrderSessionService = {
    processStep: jest.fn(),
};
const mockMetaChannelService = {
    findConnectedById: jest.fn(),
    findUniqueConnectedByShopAndPlatform: jest.fn(),
    getSettings: jest.fn(),
};

jest.mock('express-validator', () => ({
    validationResult: jest.fn(() => ({ isEmpty: () => true })),
}));
jest.mock('../conversation-state-standalone.service', () => mockConversationStateService);
jest.mock('../../order/order-session-standalone.service', () => mockOrderSessionService);
jest.mock('../../channel-providers/meta-channel.service', () => mockMetaChannelService);
jest.mock('../../shop/shop.service', () => ({
    getShopAiSettings: jest.fn(),
}));
jest.mock('../../../utils/cache.service', () => ({
    getForShop: jest.fn(async () => null),
    setForShop: jest.fn(async () => undefined),
}));
jest.mock('../../ai/prompt-sanitizer.service', () => ({ isTooLong: jest.fn(() => false) }));
jest.mock('../../entities', () => ({ SupportTicket: { create: jest.fn() } }));
jest.mock('../../ai/intent-router.service', () => ({}));
jest.mock('../../knowledge/knowledge.service', () => ({}));
jest.mock('../../subscription/subscription.plans', () => ({ planHasFeature: jest.fn(() => false) }));
jest.mock('../../ai/grounding', () => ({
    evaluateCandidate: jest.fn(() => ({ decision: 'SEND', text: 'reply', reasonCode: null })),
    logGroundingDecision: jest.fn(),
    isModelGenerated: jest.fn(() => false),
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })),
}));

const AIChatbotController = require('../ai-chatbot.controller');

const makeResponse = () => ({
    status: jest.fn(function status() { return this; }),
    json: jest.fn(),
});

const baseRequest = (overrides = {}) => ({
    body: {
        shop_id: SHOP_ID,
        customer_channel_id: 'psid-1',
        platform: 'facebook',
        message: 'hello',
        ...overrides,
    },
});

beforeEach(() => {
    jest.clearAllMocks();
    mockMetaChannelService.findConnectedById.mockResolvedValue({
        id: CHANNEL_ID,
        shop_id: SHOP_ID,
        platform: 'facebook',
        status: 'CONNECTED',
    });
    mockMetaChannelService.findUniqueConnectedByShopAndPlatform.mockResolvedValue(null);
    mockMetaChannelService.getSettings.mockResolvedValue({});
    mockConversationStateService.ingestMessage.mockResolvedValue({
        conversation_id: 'conversation-1',
        conversation_history: [],
        active_order_session: { id: 'order-session-1', status: 'ACTIVE' },
    });
    mockConversationStateService.storeAIResponse.mockResolvedValue(undefined);
    mockOrderSessionService.processStep.mockResolvedValue({ prompt: 'reply', confidence: 1 });
});

describe('AI chatbot exact channel routing', () => {
    test('passes the exact channel to ingestion and settings without shop-wide fallback', async () => {
        const res = makeResponse();

        await AIChatbotController.processMessage(baseRequest({ meta_channel_id: CHANNEL_ID }), res);

        expect(mockMetaChannelService.findConnectedById).toHaveBeenCalledWith(CHANNEL_ID, {
            shopId: SHOP_ID,
            platform: 'facebook',
        });
        expect(mockMetaChannelService.findUniqueConnectedByShopAndPlatform).not.toHaveBeenCalled();
        expect(mockConversationStateService.ingestMessage).toHaveBeenCalledWith(expect.objectContaining({
            meta_channel_id: CHANNEL_ID,
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('rejects an unresolvable explicit channel before ingestion', async () => {
        const res = makeResponse();
        mockMetaChannelService.findConnectedById.mockResolvedValueOnce(null);

        await AIChatbotController.processMessage(baseRequest({ meta_channel_id: CHANNEL_ID }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        expect(mockConversationStateService.ingestMessage).not.toHaveBeenCalled();
        expect(mockMetaChannelService.findUniqueConnectedByShopAndPlatform).not.toHaveBeenCalled();
    });
});
