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

const fs = require('fs');
const path = require('path');

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
const mockStoredAiMessageUpdate = jest.fn();
const mockStoreAIResponse = jest.fn(async (_conversationId, content) => ({
    message: { id: 'ai-1', content, metadata: {}, update: mockStoredAiMessageUpdate },
}));
jest.mock('src/modules/conversation/conversation-state-standalone.service', () => ({
    detectLanguage: jest.fn(() => 'mixed'),
    extractEntities: jest.fn(() => ({})),
    storeAIResponse: mockStoreAIResponse,
}));
jest.mock('src/modules/channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('src/utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('src/modules/policy/policy.engine', () => ({
    evaluateOutbound: jest.fn(async () => ({ allow: true, decisionId: 'dec-1' })),
}));
jest.mock('src/modules/channel-providers/meta-channel.service', () => ({
    findConnectedById: jest.fn(async () => ({
        id: 'ch-1', shop_id: 'shop-a', platform: 'facebook', status: 'CONNECTED', meta_asset_id: 'page-1',
    })),
    findByMetaAssetId: jest.fn(async () => null),
    findUniqueConnectedByShopAndPlatform: jest.fn(async () => ({
        id: 'ch-1', shop_id: 'shop-a', platform: 'facebook', status: 'CONNECTED', meta_asset_id: 'page-1',
    })),
    getSettings: jest.fn(async () => ({ automation_mode: 'DRAFT', ai_auto_reply: true })),
}));
jest.mock('src/modules/channel-providers/meta-channel.entity', () => ({ findByPk: jest.fn(async () => null) }));
const mockCustomerFindOne = jest.fn(async () => ({
    id: 'cust-1',
    shop_id: 'shop-a',
    channel_type: 'messenger',
    channel_user_id: '12345',
}));
jest.mock('src/modules/customer/customer.entity', () => ({ findOne: mockCustomerFindOne }));
const mockGetShopAiSettings = jest.fn(async () => ({ automation_mode: 'AI_ACTIVE', confidence_threshold: 75 }));
jest.mock('src/modules/shop/shop.service', () => ({ getShopAiSettings: mockGetShopAiSettings }));
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
jest.mock('src/modules/ai/recovery/turn-recovery.service', () => ({
    startTurn: jest.fn(async ({ traceId }) => ({
        turn: { trace_id: traceId, turn_started_at: new Date(), state: 'RECEIVED' },
    })),
    transition: jest.fn(async () => {}),
    requireHuman: jest.fn(async (input) => ({
        turn: null,
        handoff: await require('src/modules/conversation/human-handoff.service').escalateToHuman(input),
    })),
    isHoldingSuppressed: jest.fn(() => false),
    isHardTimeoutSuppressed: jest.fn(() => false),
}));

const { processMessageJob, _private } = require('src/jobs/message-worker');
const { Conversation } = require('src/modules/conversation/conversation.entity');
const { getProvider } = require('src/modules/channel-providers/provider.registry');
const metaChannelService = require('src/modules/channel-providers/meta-channel.service');
const AIChatbotController = require('src/modules/conversation/ai-chatbot.controller');
const { escalateToHuman } = require('src/modules/conversation/human-handoff.service');
const grounding = require('src/modules/ai/grounding');
const { handleOrderFlow } = require('src/modules/conversation/order-flow.service');
const { opsAlert } = require('src/utils/ops-alert');
const merchantNotificationService = require('src/modules/notification/merchant-notification.service');

const SHOP = 'shop-a';
const PHOTO_URL = 'https://cdn.easymod.tech/products/black-saree.jpg';

const sendMessage = jest.fn(async () => ({ ok: true, providerMessageId: 'provider-1' }));

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
    mockCustomerFindOne.mockResolvedValue({
        id: 'cust-1',
        shop_id: 'shop-a',
        channel_type: 'messenger',
        channel_user_id: '12345',
    });
    mockGetShopAiSettings.mockResolvedValue({ automation_mode: 'AI_ACTIVE', confidence_threshold: 75 });
    metaChannelService.getSettings.mockResolvedValue({ automation_mode: 'DRAFT', ai_auto_reply: true });
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

describe('message-worker channel routing', () => {
    test('resolves an explicit channel only when shop, platform, status, and Page match', async () => {
        const channel = {
            id: 'ch-1',
            shop_id: SHOP,
            platform: 'facebook',
            status: 'CONNECTED',
            meta_asset_id: 'page-1',
        };
        metaChannelService.findConnectedById.mockResolvedValueOnce(channel);

        await expect(_private.resolveChannelForJob(SHOP, 'messenger', 'ch-1', 'page-1'))
            .resolves.toBe(channel);
        expect(metaChannelService.findConnectedById).toHaveBeenCalledWith('ch-1', {
            shopId: SHOP,
            platform: 'facebook',
            metaAssetId: 'page-1',
        });
        expect(metaChannelService.findUniqueConnectedByShopAndPlatform).not.toHaveBeenCalled();
    });

    test('never falls back to a shop-wide channel when the explicit channel is invalid', async () => {
        metaChannelService.findConnectedById.mockResolvedValueOnce(null);

        await expect(_private.resolveChannelForJob(SHOP, 'facebook', 'stale-channel', 'page-1'))
            .resolves.toBeNull();
        expect(metaChannelService.findUniqueConnectedByShopAndPlatform).not.toHaveBeenCalled();
    });

    test('propagates an explicit channel lookup failure instead of converting it to no channel', async () => {
        const lookupError = new Error('channel store unavailable');
        metaChannelService.findConnectedById.mockRejectedValueOnce(lookupError);

        await expect(_private.resolveChannelForJob(SHOP, 'facebook', 'channel-1', 'page-1'))
            .rejects.toBe(lookupError);
        expect(metaChannelService.findUniqueConnectedByShopAndPlatform).not.toHaveBeenCalled();
    });

    test('retries a job with no resolved channel without entering the AI or send path', async () => {
        metaChannelService.findConnectedById.mockResolvedValueOnce(null);

        await expect(processMessageJob(job({ metaChannelId: 'stale-channel' }))).rejects.toMatchObject({
            code: 'META_CHANNEL_UNAVAILABLE',
            retryable: true,
        });
        expect(AIChatbotController.processNewIntent).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('rejects an explicit channel returned with a different Page asset', async () => {
        metaChannelService.findConnectedById.mockResolvedValueOnce({
            id: 'ch-1',
            shop_id: SHOP,
            platform: 'facebook',
            status: 'CONNECTED',
            meta_asset_id: 'page-2',
        });

        await expect(_private.resolveChannelForJob(SHOP, 'facebook', 'ch-1', 'page-1'))
            .resolves.toBeNull();
        expect(metaChannelService.findUniqueConnectedByShopAndPlatform).not.toHaveBeenCalled();
    });

    test('resolves a supplied Page asset without falling back to an arbitrary shop channel', async () => {
        const channel = {
            id: 'ch-1',
            shop_id: SHOP,
            platform: 'facebook',
            status: 'CONNECTED',
            meta_asset_id: 'page-1',
        };
        metaChannelService.findByMetaAssetId.mockResolvedValueOnce(channel);

        await expect(_private.resolveChannelForJob(SHOP, 'facebook', null, 'page-1'))
            .resolves.toBe(channel);
        expect(metaChannelService.findUniqueConnectedByShopAndPlatform).not.toHaveBeenCalled();
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

        expect(cacheRedis.del).toHaveBeenCalledWith('msg:dedup:shop-a:facebook:ext-1');
    });

    test('persists acknowledged components when a later provider component fails', async () => {
        const partialError = Object.assign(new Error('attachment fetch failed'), {
            code: 'META_API_ERROR',
            providerMessageIds: ['mid_text_partial'],
            providerComponents: [
                { index: 0, type: 'text', attempted: true, status: 'ACKNOWLEDGED', providerMessageId: 'mid_text_partial' },
                { index: 1, type: 'image', attempted: true, status: 'FAILED', providerMessageId: null, failureCode: 100 },
            ],
            providerFailure: { code: 'META_API_ERROR', status: 400, metaCode: 100, metaSubcode: 2018001 },
        });
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'Photo attached',
            confidence: 0.9,
            source: 'llm',
            provider: 'gemini-lite',
            grounding: verifiedEvidence({ photo: PHOTO_URL }),
            attachments: [{ type: 'image', url: PHOTO_URL, productId: 'p-1' }],
        });
        sendMessage.mockRejectedValueOnce(partialError);

        await expect(processMessageJob(job())).rejects.toBe(partialError);

        expect(mockStoredAiMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
            provider_message_id: 'mid_text_partial',
            metadata: expect.objectContaining({
                delivered: false,
                delivery_state: 'FAILED',
                provider_send_attempted: true,
                provider_message_ids: ['mid_text_partial'],
                provider_components: expect.arrayContaining([
                    expect.objectContaining({ type: 'text', status: 'ACKNOWLEDGED' }),
                    expect.objectContaining({ type: 'image', status: 'FAILED' }),
                ]),
                provider_failure: expect.objectContaining({ metaCode: 100, metaSubcode: 2018001 }),
            }),
        }));
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

    test('a policy denial after order mutation holds the deterministic template without sending', async () => {
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

        expect(result).toEqual(expect.objectContaining({
            sent: false,
            reason: 'post_mutation_template',
        }));
        expect(sendMessage).not.toHaveBeenCalled();
        expect(mockStoreAIResponse).toHaveBeenCalledWith(
            'conv-1',
            expect.stringContaining('ORD-1'),
            expect.objectContaining({ order_flow: expect.any(Object) }),
        );
        expect(mockStoredAiMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                delivered: false,
                held_reason: 'executed_mutation_without_outbound_send',
                delivery_state: 'HELD',
            }),
            delivery_state: 'HELD',
        }));
        expect(opsAlert).toHaveBeenCalledWith(
            'executed_mutation_without_outbound_send',
            expect.objectContaining({ level: 'error' }),
        );
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            SHOP,
            'ai_hitl',
            expect.objectContaining({
                reason: 'executed_mutation_without_outbound_send',
                orderNumber: 'ORD-1',
            }),
            expect.any(Object),
        );
    });

    test('a grounding denial after order mutation also holds and alerts without sending', async () => {
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

        const result = await processMessageJob(job({ message: 'yes' }));

        expect(result.sent).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
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

    test('grounding suppression after order mutation holds the deterministic response without a synthetic allow', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success',
            confidence: 1,
            meta: {
                completed: true,
                order: { id: 'ord-grounding', order_number: 'ORD-G', order_status: 'confirmed' },
            },
        });
        const evaluateCandidate = jest.spyOn(grounding, 'evaluateCandidate').mockReturnValue({
            decision: grounding.GroundingDecision.SUPPRESS,
            reasonCode: grounding.ReasonCode.MODEL_OUTPUT_INVALID,
            text: null,
            attachments: [],
            violations: ['forced_test_suppression'],
        });

        try {
            const result = await processMessageJob(job({ message: 'yes' }));

            expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'post_mutation_template' }));
            expect(sendMessage).not.toHaveBeenCalled();
            expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
                SHOP,
                'ai_hitl',
                expect.objectContaining({ reason: 'executed_mutation_without_outbound_send' }),
                expect.any(Object),
            );
        } finally {
            evaluateCandidate.mockRestore();
        }
    });

    test('grounding dependency failure after order mutation holds and alerts without sending', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success',
            confidence: 1,
            meta: {
                completed: true,
                order: { id: 'ord-grounding-error', order_number: 'ORD-GE', order_status: 'confirmed' },
            },
        });
        const evaluateCandidate = jest.spyOn(grounding, 'evaluateCandidate')
            .mockImplementationOnce(() => { throw new Error('grounding dependency unavailable'); });

        try {
            const result = await processMessageJob(job({ message: 'yes' }));

            expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'post_mutation_template' }));
            expect(sendMessage).not.toHaveBeenCalled();
            expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
                SHOP,
                'ai_hitl',
                expect.objectContaining({ reason: 'executed_mutation_without_outbound_send' }),
                expect.any(Object),
            );
        } finally {
            evaluateCandidate.mockRestore();
        }
    });

    test('post-mutation draft persistence failure still alerts and never reports a send', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success',
            confidence: 1,
            meta: {
                completed: true,
                order: { id: 'ord-store-error', order_number: 'ORD-SE', order_status: 'confirmed' },
            },
        });
        mockStoreAIResponse.mockRejectedValueOnce(new Error('AI response store unavailable'));
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockResolvedValueOnce({ allow: false, reason: 'NO_CONSENT', decisionId: 'deny-store' });

        await expect(processMessageJob(job({ message: 'yes' }))).rejects.toThrow('AI response store unavailable');
        expect(sendMessage).not.toHaveBeenCalled();
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            SHOP,
            'ai_hitl',
            expect.objectContaining({ reason: 'executed_mutation_without_outbound_send' }),
            expect.any(Object),
        );
    });

    test('customer context dependency failure after order mutation holds and alerts without sending', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success',
            confidence: 1,
            meta: {
                completed: true,
                order: { id: 'ord-customer-error', order_number: 'ORD-CE', order_status: 'confirmed' },
            },
        });
        mockCustomerFindOne.mockRejectedValueOnce(new Error('customer store unavailable'));

        const result = await processMessageJob(job({ message: 'yes' }));

        expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'post_mutation_template' }));
        expect(sendMessage).not.toHaveBeenCalled();
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            SHOP,
            'ai_hitl',
            expect.objectContaining({ reason: 'executed_mutation_without_outbound_send' }),
            expect.any(Object),
        );
    });

    test('latest channel settings failure after order mutation holds and alerts without sending', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success',
            confidence: 1,
            meta: {
                completed: true,
                order: { id: 'ord-settings-error', order_number: 'ORD-SE2', order_status: 'confirmed' },
            },
        });
        metaChannelService.getSettings
            .mockResolvedValueOnce({ automation_mode: 'AI_ACTIVE', ai_auto_reply: true })
            .mockRejectedValueOnce(new Error('latest channel settings unavailable'));

        const result = await processMessageJob(job({ message: 'yes' }));

        expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'post_mutation_template' }));
        expect(sendMessage).not.toHaveBeenCalled();
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            SHOP,
            'ai_hitl',
            expect.objectContaining({ reason: 'executed_mutation_without_outbound_send' }),
            expect.any(Object),
        );
    });

    test('channel disconnect after order mutation holds and alerts without sending', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success',
            confidence: 1,
            meta: {
                completed: true,
                order: { id: 'ord-disabled', order_number: 'ORD-D', order_status: 'confirmed' },
            },
        });
        const channel = {
            id: 'ch-1',
            shop_id: SHOP,
            platform: 'facebook',
            status: 'CONNECTED',
            meta_asset_id: 'page-1',
        };
        metaChannelService.findUniqueConnectedByShopAndPlatform.mockResolvedValueOnce(channel);
        metaChannelService.getSettings
            .mockResolvedValueOnce({ automation_mode: 'AI_ACTIVE', ai_auto_reply: true })
            .mockImplementationOnce(async () => {
                channel.status = 'DISCONNECTED';
                return { automation_mode: 'AI_ACTIVE', ai_auto_reply: true };
            });

        const result = await processMessageJob(job({ message: 'yes' }));

        expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'post_mutation_template' }));
        expect(sendMessage).not.toHaveBeenCalled();
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            SHOP,
            'ai_hitl',
            expect.objectContaining({ reason: 'executed_mutation_without_outbound_send' }),
            expect.any(Object),
        );
    });

    test('policy dependency failure after order mutation holds and alerts without sending', async () => {
        handleOrderFlow.mockResolvedValueOnce({
            handled: true,
            response: 'generated order success',
            confidence: 1,
            meta: {
                completed: true,
                order: { id: 'ord-policy-error', order_number: 'ORD-PE', order_status: 'confirmed' },
            },
        });
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockRejectedValueOnce(new Error('policy dependency unavailable'));

        const result = await processMessageJob(job({ message: 'yes' }));

        expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'post_mutation_template' }));
        expect(sendMessage).not.toHaveBeenCalled();
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            SHOP,
            'ai_hitl',
            expect.objectContaining({ reason: 'executed_mutation_without_outbound_send' }),
            expect.any(Object),
        );
    });

    test.each([
        ['DRAFT', 'DRAFT_MODE'],
        ['MANUAL', 'MANUAL'],
        ['HUMAN_ACTIVE', 'HUMAN_ACTIVE'],
        ['opt-out', 'OPTED_OUT'],
        ['no consent', 'NO_CONSENT'],
        ['window', 'OUTSIDE_24H_TEMPLATES_DISABLED'],
    ])('holds a %s policy denial as a visible draft and never sends', async (_label, reason) => {
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockResolvedValueOnce({ allow: false, reason, decisionId: `deny-${reason}` });
        AIChatbotController.processNewIntent.mockResolvedValue({
            response: 'candidate response',
            confidence: 0.9,
            source: 'llm',
            grounding: grounding.emptyEvidence(SHOP),
            attachments: [],
        });

        const result = await processMessageJob(job());

        expect(result).toEqual(expect.objectContaining({ sent: false, reason }));
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('does not send or report success when the final customer context lookup fails', async () => {
        mockCustomerFindOne.mockRejectedValueOnce(new Error('customer store unavailable'));

        await expect(processMessageJob(job())).rejects.toThrow('customer store unavailable');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('does not send when the final customer context is unknown even if a dependency reports allow', async () => {
        mockCustomerFindOne.mockResolvedValueOnce(null);
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockResolvedValueOnce({ allow: true, decisionId: 'unsafe-test-allow' });

        const result = await processMessageJob(job());

        expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'CUSTOMER_CONTEXT_UNAVAILABLE' }));
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('does not send when the final customer context is incomplete', async () => {
        mockCustomerFindOne.mockResolvedValueOnce({ id: 'cust-1' });
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockResolvedValueOnce({ allow: true, decisionId: 'incomplete-context-allow' });

        const result = await processMessageJob(job());

        expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'CUSTOMER_CONTEXT_UNAVAILABLE' }));
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('retries instead of using permissive empty shop settings when the settings dependency fails', async () => {
        mockGetShopAiSettings.mockRejectedValueOnce(new Error('shop settings unavailable'));

        await expect(processMessageJob(job())).rejects.toThrow('shop settings unavailable');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('retries instead of using permissive empty channel settings when the settings dependency fails', async () => {
        metaChannelService.getSettings.mockRejectedValueOnce(new Error('channel settings unavailable'));

        await expect(processMessageJob(job())).rejects.toThrow('channel settings unavailable');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('denies instead of using an empty channel settings object', async () => {
        metaChannelService.getSettings.mockResolvedValueOnce({});

        await expect(processMessageJob(job())).rejects.toMatchObject({
            code: 'CHANNEL_SETTINGS_UNAVAILABLE',
            retryable: true,
        });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('denies instead of using an empty shop settings object', async () => {
        mockGetShopAiSettings.mockResolvedValueOnce({});

        await expect(processMessageJob(job())).rejects.toMatchObject({
            code: 'SHOP_SETTINGS_UNAVAILABLE',
            retryable: true,
        });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('holds a policy result unless allow is exactly true', async () => {
        const policyEngine = require('src/modules/policy/policy.engine');
        policyEngine.evaluateOutbound.mockResolvedValueOnce({ allow: 'true', reason: 'malformed' });

        const result = await processMessageJob(job());

        expect(result.sent).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('does not report a final send when the provider returns no result', async () => {
        AIChatbotController.processNewIntent.mockResolvedValueOnce({
            response: 'A grounded reply',
            confidence: 0.9,
            source: 'llm',
            grounding: grounding.emptyEvidence(SHOP),
            attachments: [],
        });
        sendMessage.mockResolvedValueOnce(undefined);

        await expect(processMessageJob(job())).rejects.toMatchObject({ code: 'PROVIDER_NO_SEND' });
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(mockStoredAiMessageUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ delivered: true }),
        }));
    });
});

describe('message-worker source safety boundary', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../message-worker.js'), 'utf8');

    test('has no synthetic post-mutation allow or direct provider send path', () => {
        const postMutationStart = source.indexOf('const sendPostMutationTemplate');
        const postMutationEnd = source.indexOf("if (groundingVerdict.decision", postMutationStart);
        const postMutationSource = source.slice(postMutationStart, postMutationEnd);

        expect(postMutationSource).not.toContain('allow: true');
        expect(postMutationSource).not.toContain('provider.sendMessage');
        expect(postMutationSource).toContain('notifyExecutedMutationWithoutOutbound');
    });
});
