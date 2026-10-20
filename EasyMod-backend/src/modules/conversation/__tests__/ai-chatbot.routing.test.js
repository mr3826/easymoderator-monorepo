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
const mockIntentRouter = {
    buildSystemPrompt: jest.fn(),
    route: jest.fn(),
};
const mockKnowledgeService = {
    getKnowledgeForAI: jest.fn(),
    getRelevantFaqs: jest.fn(),
};
const mockOperatingContextService = {
    getOperatingContext: jest.fn(),
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
jest.mock('../../ai/intent-router.service', () => mockIntentRouter);
jest.mock('../../knowledge/knowledge.service', () => mockKnowledgeService);
jest.mock('../../ai/shop-operating-context.service', () => mockOperatingContextService);
jest.mock('../../subscription/subscription.plans', () => ({ planHasFeature: jest.fn(() => false) }));
jest.mock('../../ai/grounding', () => ({
    evaluateCandidate: jest.fn(() => ({ decision: 'SEND', text: 'reply', reasonCode: null })),
    logGroundingDecision: jest.fn(),
    isModelGenerated: jest.fn(() => false),
    contextSelectedVariants: jest.fn(() => ({})),
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })),
}));

const AIChatbotController = require('../ai-chatbot.controller');
const shopService = require('../../shop/shop.service');
const intentRouter = require('../../ai/intent-router.service');
const knowledgeService = require('../../knowledge/knowledge.service');
const operatingContextService = require('../../ai/shop-operating-context.service');
const productEvidence = require('../../ai/grounding/product-evidence.service');
const grounding = require('../../ai/grounding');
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
    knowledgeService.getKnowledgeForAI.mockResolvedValue({});
    knowledgeService.getRelevantFaqs.mockResolvedValue([]);
    operatingContextService.getOperatingContext.mockResolvedValue(
        '--- SHOP PAYMENT & DELIVERY (authoritative) ---\nAccepted payment: Cash on Delivery (COD) ONLY.',
    );
    intentRouter.buildSystemPrompt.mockReturnValue('BASE');
    grounding.contextSelectedVariants.mockImplementation((history, { shopId }) =>
        productEvidence.contextSelectedVariants(history, { shopId }));
});

describe('AI chatbot exact channel routing', () => {
    test('the controller returns a current product presentation with the prior selected variant', async () => {
        const liveProduct = {
            id: 'product-1',
            shop_id: SHOP_ID,
            name: 'Classic Blue Denim Jacket',
            price: 3200,
            is_active: true,
            in_stock: true,
            track_quantity: false,
            quantity: 0,
            variants: [
                { id: 'variant-m', option_name: 'Size', option_value: 'M', price: 3200, quantity: 2, is_active: true },
                { id: 'variant-xl', option_name: 'Size', option_value: 'XL', price: 3300, quantity: 1, is_active: true },
            ],
            images: [],
        };
        const evidence = productEvidence.resolveContextualAttributeEvidence({
            shopId: SHOP_ID,
            message: 'price?',
            contextProducts: [liveProduct],
        });
        const priorPresentation = {
            shopId: SHOP_ID,
            products: [{
                id: 'product-1',
                selectedVariant: { id: 'variant-xl', option: 'Size', value: 'XL' },
            }],
        };
        const history = [{
            role: 'assistant',
            sourceReferences: [{ kind: 'product', id: 'product-1', title: liveProduct.name }],
            productPresentation: priorPresentation,
        }];
        intentRouter.route.mockResolvedValue({
            response: 'Classic Blue Denim Jacket — Size XL — ৳3,300',
            confidence: 1,
            source: 'grounding_product_presentation',
            grounding: evidence,
            sourceReferences: [{ kind: 'product', id: 'product-1', title: liveProduct.name }],
        });

        const result = await AIChatbotController.processNewIntent(
            'price?', history, {}, 'en', { tone_persona: 'friendly_bd' },
            { shop_id: SHOP_ID, conversation_id: 'conversation-1', customer_channel_id: 'psid-1', platform: 'facebook' },
        );

        expect(result.productPresentation.products[0].selectedVariant).toEqual({
            id: 'variant-xl', option: 'Size', value: 'XL',
        });
        expect(result.productPresentation.products[0].price).toEqual({
            state: 'KNOWN', amount: 3300, currency: 'BDT',
        });
        expect(result.productPresentation.products[0].price.amount).not.toBe(3200);
    });

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
                business_hours: { mon: { open: '09:00', close: '18:00' } },
                confidence_threshold_send: 0.8,
                confidence_threshold_suggest: 0.5,
                allow_order_creation: false,
                purpose_label: 'Sales',
            });

            await AIChatbotController.processMessage(baseRequest({ meta_channel_id: CHANNEL_ID }), res);

            const payload = res.json.mock.calls[0][0];
            expect(payload).toEqual(expect.objectContaining({ success: true }));
            expect(payload.metadata).toEqual(expect.objectContaining({ is_draft: expectedDraft }));
            expect(payload.metadata.ai_settings.automation_mode).toBe(expectedMode);
            expect(payload.metadata.ai_settings).toEqual(expect.objectContaining({
                business_hours: { mon: { open: '09:00', close: '18:00' } },
                confidence_threshold_send: 0.8,
                confidence_threshold_suggest: 0.5,
                allow_order_creation: false,
                purpose_label: 'Sales',
            }));
            expect(payload.metadata.ai_settings).not.toHaveProperty('ai_auto_reply');
            expect(mockConversationStateService.updateConversationState).toHaveBeenCalledWith(
                'conversation-1',
                expect.objectContaining({ automation_mode: expectedMode }),
            );
        },
    );
});
