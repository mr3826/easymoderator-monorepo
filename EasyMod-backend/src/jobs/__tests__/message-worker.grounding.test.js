'use strict';

/**
 * The outbound boundary: what actually reaches Meta.
 *
 * The grounding module is deliberately NOT mocked here — these tests run the
 * real gate inside the real worker so the assertion is about the send call
 * itself, not about a helper in isolation. Before the gate existed, whatever
 * the model produced was handed to provider.sendMessage verbatim, with
 * `attachments: []` hard-coded.
 */

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
jest.mock('src/modules/conversation/conversation-state-standalone.service', () => ({
    detectLanguage: jest.fn(() => 'mixed'),
    extractEntities: jest.fn(() => ({})),
    storeAIResponse: jest.fn(async (_c, content) => ({ message: { id: 'ai-1', content, metadata: {}, update: jest.fn() } })),
}));
jest.mock('src/modules/channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('src/utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('src/modules/policy/policy.engine', () => ({
    evaluateOutbound: jest.fn(async () => ({ allow: true, decisionId: 'dec-1' })),
}));
jest.mock('src/modules/channel-providers/meta-channel.service', () => ({
    findByShopAndPlatform: jest.fn(async () => ({ id: 'ch-1', shop_id: 'shop-a' })),
    getSettings: jest.fn(async () => ({})),
}));
jest.mock('src/modules/channel-providers/meta-channel.entity', () => ({ findByPk: jest.fn(async () => null) }));
jest.mock('src/modules/customer/customer.entity', () => ({ findOne: jest.fn(async () => ({ id: 'cust-1' })) }));
jest.mock('src/modules/shop/shop.service', () => ({
    getShopAiSettings: jest.fn(async () => ({ automation_mode: 'AI_ACTIVE', confidence_threshold: 75 })),
}));
jest.mock('src/modules/entities', () => ({ Subscription: { findOne: jest.fn(async () => ({ status: 'active' })) } }));
jest.mock('src/modules/subscription/subscription.access', () => ({ isAiActive: jest.fn(() => true) }));
jest.mock('src/modules/ai/sentiment.service', () => ({
    analyzeSentiment: jest.fn(async () => ({ sentiment: 'neutral', score: 0, method: 'keyword' })),
    shouldAutoEscalate: jest.fn(() => false),
}));
jest.mock('src/modules/conversation/order-flow.service', () => ({
    handleOrderFlow: jest.fn(async () => ({ handled: false })),
    hasPurchaseIntent: jest.fn(() => false),
}));
jest.mock('src/modules/conversation/ai-chatbot.controller', () => ({ processNewIntent: jest.fn() }));
jest.mock('src/modules/conversation/human-handoff.service', () => ({ escalateToHuman: jest.fn(async () => {}) }));
jest.mock('src/modules/notification/merchant-notification.service', () => ({
    notifyShop: jest.fn(async () => ({ queued: true })),
}));
jest.mock('src/modules/notification/notification-events', () => ({
    NOTIFICATION_EVENTS: { AI_HITL: 'ai_hitl' },
}));
jest.mock('src/modules/knowledge/knowledge-gap-capture.service', () => ({ recordKnowledgeGap: jest.fn(async () => {}) }));
jest.mock('src/modules/analytics/growth-metrics.service', () => ({ recordActivation: jest.fn(() => Promise.resolve()) }));
jest.mock('src/modules/analytics/funnel-events.service', () => ({ recordFunnelEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('src/modules/shop/ai-messaging', () => ({ buildGreeting: jest.fn(() => '') }));
jest.mock('src/modules/shop/shop.entity', () => ({ findByPk: jest.fn(async () => ({ name: 'Demo', settings: {} })) }));

const { processMessageJob } = require('src/jobs/message-worker');
const { Conversation } = require('src/modules/conversation/conversation.entity');
const { getProvider } = require('src/modules/channel-providers/provider.registry');
const AIChatbotController = require('src/modules/conversation/ai-chatbot.controller');
const { escalateToHuman } = require('src/modules/conversation/human-handoff.service');
const grounding = require('src/modules/ai/grounding');
const { handleOrderFlow } = require('src/modules/conversation/order-flow.service');
const { opsAlert } = require('src/utils/ops-alert');

const SHOP = 'shop-a';
const PHOTO_URL = 'https://cdn.easymod.tech/products/black-saree.jpg';

const sendMessage = jest.fn(async () => ({ ok: true }));

const job = (over = {}) => ({
    data: {
        shopId: SHOP,
        conversationId: 'conv-1',
        messageId: 'msg-1',
        externalId: 'ext-1',
        message: 'black saree picture den',
        platform: 'facebook',
        recipientId: '12345',
        senderInfo: {},
        ...over,
    },
    moveToDelayed: jest.fn(),
    token: 't',
});

/** Evidence for one verified product of this shop, with or without a photo. */
const verifiedEvidence = ({ photo = null, material = null } = {}) => grounding.resolveProductEvidence({
    shopId: SHOP,
    message: 'black saree picture den',
    candidates: [{
        id: 'p-1',
        name: 'Premium Black Saree',
        category: 'saree',
        price: 1490,
        quantity: 3,
        in_stock: true,
        is_active: true,
        variants: [],
        images: [],
        image_url: photo,
        tags: [],
        ai_color: 'black',
        ai_material: material,
    }],
});

const sentPayload = () => sendMessage.mock.calls[0][0].normalizedMessage;

beforeEach(() => {
    jest.clearAllMocks();
    Conversation.findOne.mockResolvedValue({ id: 'conv-1', hitl: false, status: 'open' });
    getProvider.mockReturnValue({ sendMessage });
});

describe('grounded replies reach Meta intact', () => {
    test('a verified product photo is attached to the outbound message', async () => {
        const evidence = verifiedEvidence({ photo: PHOTO_URL });
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'Premium Black Saree — ৳1490 😊',
            confidence: 0.9,
            source: 'llm',
            provider: 'gemini-lite',
            grounding: evidence,
            attachments: [{ type: 'image', url: PHOTO_URL, productId: 'p-1' }],
        });

        const result = await processMessageJob(job());

        expect(result.sent).toBe(true);
        expect(sentPayload().attachments).toEqual([{ type: 'image', url: PHOTO_URL, productId: 'p-1' }]);
        expect(sentPayload().text).toContain('৳1490');
    });

    test('media belonging to another product never leaves the worker', async () => {
        const evidence = verifiedEvidence({ photo: PHOTO_URL });
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'Premium Black Saree — ৳1490',
            confidence: 0.9,
            source: 'llm',
            grounding: evidence,
            attachments: [{ type: 'image', url: 'https://cdn.easymod.tech/products/someone-else.jpg' }],
        });

        await processMessageJob(job());

        expect(sentPayload().attachments).toEqual([]);
    });

    test('a product with no stored photo sends no attachment at all', async () => {
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'Premium Black Saree — ৳1490. Chobi ekhon nei.',
            confidence: 0.9,
            source: 'llm',
            grounding: verifiedEvidence({ photo: null }),
            attachments: [],
        });

        await processMessageJob(job());

        expect(sentPayload().attachments).toEqual([]);
    });
});

describe('ungrounded replies are replaced before the send', () => {
    test('an invented price is never the text handed to the provider', async () => {
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'Ji, chiffon saree ache — 2200 taka!',
            confidence: 0.9,
            source: 'llm',
            provider: 'gemini-lite',
            grounding: grounding.resolveProductEvidence({
                shopId: SHOP,
                message: 'chiffon saree ache?',
                candidates: [],
            }),
            attachments: [],
        });

        const result = await processMessageJob(job({ message: 'chiffon saree ache?' }));

        expect(result.sent).toBe(true);
        expect(sentPayload().text).not.toContain('2200');
        expect(sentPayload().text.toLowerCase()).toContain('pacchi na');
    });

    test('a Page link offered instead of a product photo is stripped', async () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'chiffon saree picture den',
            candidates: [],
        });
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'Amader page dekhen https://facebook.com/demoshop',
            confidence: 0.9,
            source: 'llm',
            grounding: evidence,
            attachments: [],
        });

        await processMessageJob(job({ message: 'chiffon saree picture den' }));

        expect(sentPayload().text).not.toContain('facebook.com');
        expect(sentPayload().attachments).toEqual([]);
    });

    test('a catalog outage holds the turn and pulls in a human instead of answering', async () => {
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'Ji, ache!',
            confidence: 0.9,
            source: 'llm',
            grounding: grounding.resolveProductEvidence({
                shopId: SHOP,
                message: 'black saree ache?',
                candidates: [],
                retrievalFailed: true,
            }),
            attachments: [],
        });

        const result = await processMessageJob(job({ message: 'black saree ache?' }));

        expect(sendMessage).not.toHaveBeenCalled();
        expect(result.reason).toBe('low_confidence_handoff');
        expect(escalateToHuman).toHaveBeenCalled();
    });

    test('an unusable completion with nothing to answer suppresses the send', async () => {
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: '',
            confidence: 0.9,
            source: 'llm',
            grounding: grounding.emptyEvidence(SHOP),
            attachments: [],
        });

        const result = await processMessageJob(job({ message: 'hmm' }));

        expect(sendMessage).not.toHaveBeenCalled();
        expect(result.reason).toBe('grounding_suppressed');
        expect(escalateToHuman).toHaveBeenCalled();
    });
});

describe('existing behaviour is preserved', () => {
    test('deterministic order-flow replies are not second-guessed by the gate', async () => {
        const { handleOrderFlow } = require('src/modules/conversation/order-flow.service');
        handleOrderFlow.mockResolvedValue({
            handled: true,
            response: 'Total ৳3,750 — apnar naam ta bolun.',
            confidence: 1.0,
            meta: { step: 'NAME' },
        });

        const result = await processMessageJob(job({ message: 'order korbo' }));

        expect(result.sent).toBe(true);
        expect(sentPayload().text).toContain('3,750');
    });

    test('a duplicate delivery is still dropped before any AI work', async () => {
        const { cacheRedis } = require('src/config/redis');
        cacheRedis.set.mockResolvedValueOnce(null); // NX claim lost → already seen

        const result = await processMessageJob(job());

        expect(result).toEqual({ skipped: true, reason: 'duplicate', externalId: 'ext-1' });
        expect(AIChatbotController.processNewIntent).not.toHaveBeenCalled();
    });

    test('releases the dedup claim when a retryable provider send fails', async () => {
        const { cacheRedis } = require('src/config/redis');
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'A grounded reply',
            confidence: 0.9,
            source: 'llm',
            provider: 'gemini-lite',
            grounding: grounding.emptyEvidence(SHOP),
            attachments: [],
        });
        sendMessage.mockRejectedValueOnce(new Error('temporary Meta failure'));

        await expect(processMessageJob(job())).rejects.toThrow('temporary Meta failure');

        expect(cacheRedis.del).toHaveBeenCalledWith('msg:dedup:shop-a:ext-1');
    });

    test('a policy denial still holds the reply as a draft rather than sending', async () => {
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockResolvedValueOnce({ allow: false, reason: 'OUTSIDE_24H' });
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'Premium Black Saree — ৳1490',
            confidence: 0.9,
            source: 'llm',
            grounding: verifiedEvidence({ photo: PHOTO_URL }),
            attachments: [],
        });

        const result = await processMessageJob(job());

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('OUTSIDE_24H');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('a policy denial after order mutation sends the deterministic post-mutation template', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success with unsupported claims',
            confidence: 0.1,
            meta: {
                completed: true,
                order: { id: 'ord-1', order_number: 'ORD-1', order_status: 'confirmed' },
            },
        });
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockResolvedValueOnce({ allow: false, reason: 'DRAFT_MODE', decisionId: 'deny-1' });

        const result = await processMessageJob(job({ message: 'yes' }));

        expect(result.sent).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sentPayload().text).toBe('অর্ডার #ORD-1 | স্ট্যাটাস: confirmed');
        expect(sentPayload().text).not.toContain('generated order success');
    });

    test('a failed post-mutation template send alerts operations and the merchant', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success',
            confidence: 0.1,
            meta: {
                completed: true,
                order: { id: 'ord-2', order_number: 'ORD-2', order_status: 'confirmed' },
            },
        });
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockResolvedValueOnce({ allow: false, reason: 'OUTSIDE_24H', decisionId: 'deny-2' });
        sendMessage.mockRejectedValueOnce(new Error('Meta send failed'));

        const result = await processMessageJob(job({ message: 'yes' }));

        expect(result.sent).toBe(false);
        expect(opsAlert).toHaveBeenCalledWith(
            'executed_mutation_without_outbound_send',
            expect.objectContaining({ level: 'error' })
        );
        expect(require('src/modules/notification/merchant-notification.service').notifyShop)
            .toHaveBeenCalledWith(
                SHOP,
                'ai_hitl',
                expect.objectContaining({ reason: 'executed_mutation_without_outbound_send' }),
                expect.any(Object)
            );
    });
});
