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
const shopService = require('../../shop/shop.service');
const { AI_REPLY_MODES } = require('../../shop/ai-reply-mode');

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
    shopService.getShopAiSettings.mockResolvedValue({
        automation_mode: AI_REPLY_MODES.DRAFT,
        confidence_threshold: 75,
    });
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

    test.each([
        ['AI_SUGGEST_ONLY', 'AI_ACTIVE', AI_REPLY_MODES.DRAFT, true],
        ['AI_ACTIVE', 'DRAFT', AI_REPLY_MODES.AUTO, false],
        [undefined, 'AI_ACTIVE', AI_REPLY_MODES.MANUAL, true],
    ])(
        'uses the business reply mode when business=%s and Page mode=%s',
        async (businessMode, pageMode, expectedMode, expectedDraft) => {
            const res = makeResponse();
            shopService.getShopAiSettings.mockResolvedValue({
                ...(businessMode === undefined ? {} : { automation_mode: businessMode }),
                confidence_threshold: 75,
            });
            mockMetaChannelService.getSettings.mockResolvedValue({
                automation_mode: pageMode,
                ai_auto_reply: true,
            });

            await AIChatbotController.processMessage(baseRequest({ meta_channel_id: CHANNEL_ID }), res);

            const payload = res.json.mock.calls[0][0];
            expect(payload).toEqual(expect.objectContaining({ success: true }));
            expect(payload.metadata).toEqual(expect.objectContaining({ is_draft: expectedDraft }));
            expect(payload.metadata.ai_settings.automation_mode).toBe(expectedMode);
            expect(mockConversationStateService.updateConversationState).toHaveBeenCalledWith(
                'conversation-1',
                expect.objectContaining({ automation_mode: expectedMode }),
            );
        },
    );
});
