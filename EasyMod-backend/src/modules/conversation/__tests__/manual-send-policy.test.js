'use strict';

process.env.NODE_ENV = 'test';

const conversation = {
    id: 'conv-1',
    shop_id: 'shop-1',
    channel: 'facebook',
    meta_channel_id: null,
    customer: {
        id: 'customer-1',
        shop_id: 'shop-1',
        channel_user_id: 'psid-1',
        messaging_consent: {
            facebook: {
                opted_in: true,
                opted_out_at: null,
                last_inbound_at: new Date(Date.now() - 60 * 1000).toISOString(),
            },
        },
    },
};
const metaChannel = {
    id: 'channel-1',
    shop_id: 'shop-1',
    platform: 'facebook',
    status: 'CONNECTED',
};

jest.mock('../../entities', () => ({
    Conversation: { findOne: jest.fn() },
    Customer: {},
    Message: { update: jest.fn() },
}));
jest.mock('../../subscription/subscription.service', () => ({ trackUsage: jest.fn() }));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(),
        define: jest.fn(() => ({
            findOne: jest.fn(),
            findAll: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        })),
    },
}));
jest.mock('../../channel-providers/meta-channel.service', () => ({
    findConnectedById: jest.fn(),
    findUniqueConnectedByShopAndPlatform: jest.fn(),
}));
jest.mock('../../channel-providers/meta-channel.entity', () => ({ findByPk: jest.fn() }));
jest.mock('../../channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('../../policy/policy-decision.entity', () => ({
    create: jest.fn(),
}));
jest.mock('../../shop/shop.service', () => ({
    getShopAiSettings: jest.fn(),
}));
jest.mock('../../consent/consent.service', () => ({
    hasConsent: jest.fn(),
    getLastInboundAt: jest.fn(),
}));
jest.mock('../../../utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('../../../config/redis', () => ({
    cacheRedis: {
        setex: jest.fn(),
        del: jest.fn(),
    },
}));

const { Conversation, Message } = require('../../entities');
const metaChannelService = require('../../channel-providers/meta-channel.service');
const { getProvider } = require('../../channel-providers/provider.registry');
const PolicyDecision = require('../../policy/policy-decision.entity');
const shopService = require('../../shop/shop.service');
const consentService = require('../../consent/consent.service');
const sseManager = require('../../../utils/sse-manager');
const controller = require('../conversation.controller');

describe('manual agent send policy integration', () => {
    let provider;

    beforeEach(() => {
        jest.clearAllMocks();
        Conversation.findOne.mockResolvedValue(conversation);
        Message.update.mockResolvedValue([1]);
        metaChannelService.findUniqueConnectedByShopAndPlatform.mockResolvedValue(metaChannel);
        shopService.getShopAiSettings.mockResolvedValue({ automation_mode: 'MANUAL' });
        consentService.hasConsent.mockResolvedValue(true);
        consentService.getLastInboundAt.mockReturnValue(new Date(Date.now() - 60 * 1000));
        PolicyDecision.create.mockResolvedValue({ id: 'decision-1' });
        provider = { sendMessage: jest.fn().mockResolvedValue({ providerMessageId: 'mid-1' }) };
        getProvider.mockReturnValue(provider);
    });

    test('delivers a manual-mode agent reply through the real policy engine', async () => {
        await controller._deliverViaMetaIfApplicable(
            'conv-1',
            'shop-1',
            { id: 'message-1', content: 'Hello from the shop' },
        );

        expect(shopService.getShopAiSettings).toHaveBeenCalledWith('shop-1');
        expect(PolicyDecision.create).toHaveBeenCalledWith(expect.objectContaining({
            allow: true,
            rule_results: expect.arrayContaining([
                expect.objectContaining({
                    name: 'draftMode',
                    allow: true,
                    reason: 'HUMAN_AGENT_SEND',
                }),
            ]),
        }));
        expect(provider.sendMessage).toHaveBeenCalledTimes(1);
        expect(sseManager.emit).not.toHaveBeenCalledWith(
            'shop-1',
            'delivery_failed',
            expect.anything(),
        );
    });
});
