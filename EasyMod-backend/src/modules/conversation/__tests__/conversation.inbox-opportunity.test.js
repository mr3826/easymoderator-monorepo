'use strict';

/**
 * P+01: Inbox lead intelligence projection wiring (conversation read path).
 * The Inbox shows the AUTHORITATIVE live CustomerOpportunity (never a second
 * score), only when the shop's pilot flag is enabled, and a failing read can
 * never break the inbox.
 */

process.env.NODE_ENV = 'test';

jest.mock('../../entities', () => ({
    Conversation: {},
    Message: {},
    Customer: {},
    MetaChannel: {},
    MetaChannelSettings: {},
}));
jest.mock('../../subscription/subscription.service', () => ({ trackUsage: jest.fn() }));
jest.mock('../../shop/shop.service', () => ({ getShopAiSettings: jest.fn() }));
jest.mock('../../../utils/database/database-setup', () => ({ sequelize: { transaction: jest.fn() } }));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ logUsage: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() })),
}));
jest.mock('../../pilot-features/pilot-features.service', () => ({
    isCustomerIntelligenceEnabled: jest.fn(),
}));
jest.mock('../../customer-intelligence/opportunity.service', () => ({
    liveOpportunitiesForCustomers: jest.fn(),
}));

const { Conversation } = require('../../entities');
const shopService = require('../../shop/shop.service');
const pilotFeatures = require('../../pilot-features/pilot-features.service');
const opportunityService = require('../../customer-intelligence/opportunity.service');
const conversationService = require('../conversation.service');

const row = (over = {}) => ({
    id: 'conv-1',
    shop_id: 'shop-1',
    customer_id: 'customer-1',
    channel: 'messenger',
    status: 'active',
    hitl: false,
    metadata: {},
    customer: null,
    metaChannel: null,
    ...over,
});

const oppProjection = (over = {}) => ({
    id: 'opp-1',
    status: 'OPEN',
    strength: 'HIGH',
    reasons: ['PURCHASE_INTENT'],
    recommended_action: { code: 'REPLY_IN_INBOX' },
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    shopService.getShopAiSettings.mockResolvedValue({ automation_mode: 'AI_ACTIVE' });
});

describe('conversation list open_opportunity', () => {
    it('attaches the authoritative live opportunity when the pilot flag is on', async () => {
        Conversation.findAndCountAll = jest.fn().mockResolvedValue({ rows: [row()], count: 1 });
        pilotFeatures.isCustomerIntelligenceEnabled.mockResolvedValue(true);
        opportunityService.liveOpportunitiesForCustomers.mockResolvedValue(
            new Map([['customer-1', oppProjection()]]),
        );

        const result = await conversationService.getConversations('shop-1');

        expect(opportunityService.liveOpportunitiesForCustomers)
            .toHaveBeenCalledWith('shop-1', ['customer-1']);
        expect(result.conversations[0].open_opportunity).toMatchObject({
            id: 'opp-1',
            status: 'OPEN',
            strength: 'HIGH',
            reasons: ['PURCHASE_INTENT'],
            recommended_action: { code: 'REPLY_IN_INBOX' },
        });
    });

    it('does not query opportunities when the flag is off and projects null', async () => {
        Conversation.findAndCountAll = jest.fn().mockResolvedValue({ rows: [row()], count: 1 });
        pilotFeatures.isCustomerIntelligenceEnabled.mockResolvedValue(false);

        const result = await conversationService.getConversations('shop-1');

        expect(opportunityService.liveOpportunitiesForCustomers).not.toHaveBeenCalled();
        expect(result.conversations[0].open_opportunity).toBeNull();
    });

    it('a failing opportunity read never breaks the inbox list (resilient, null)', async () => {
        Conversation.findAndCountAll = jest.fn().mockResolvedValue({ rows: [row()], count: 1 });
        pilotFeatures.isCustomerIntelligenceEnabled.mockResolvedValue(true);
        opportunityService.liveOpportunitiesForCustomers.mockRejectedValue(new Error('db down'));

        const result = await conversationService.getConversations('shop-1');

        expect(result.conversations[0].open_opportunity).toBeNull();
    });

    it('a failing flag lookup is treated as OFF (fail-closed projection)', async () => {
        Conversation.findAndCountAll = jest.fn().mockResolvedValue({ rows: [row()], count: 1 });
        pilotFeatures.isCustomerIntelligenceEnabled.mockRejectedValue(new Error('lookup failed'));

        const result = await conversationService.getConversations('shop-1');

        expect(opportunityService.liveOpportunitiesForCustomers).not.toHaveBeenCalled();
        expect(result.conversations[0].open_opportunity).toBeNull();
    });

    it('conversations without a customer never trigger the lookup', async () => {
        Conversation.findAndCountAll = jest.fn().mockResolvedValue({ rows: [row({ customer_id: null })], count: 1 });
        pilotFeatures.isCustomerIntelligenceEnabled.mockResolvedValue(true);

        const result = await conversationService.getConversations('shop-1');

        expect(opportunityService.liveOpportunitiesForCustomers).not.toHaveBeenCalled();
        expect(result.conversations[0].open_opportunity).toBeNull();
    });
});

describe('conversation detail open_opportunity', () => {
    it('includes the live opportunity for a flagged shop', async () => {
        Conversation.findOne = jest.fn().mockResolvedValue(row());
        pilotFeatures.isCustomerIntelligenceEnabled.mockResolvedValue(true);
        opportunityService.liveOpportunitiesForCustomers.mockResolvedValue(
            new Map([['customer-1', oppProjection({ status: 'ACTIONED' })]]),
        );

        const result = await conversationService.getConversationById('conv-1', 'shop-1');

        expect(result.open_opportunity).toMatchObject({ id: 'opp-1', status: 'ACTIONED' });
    });

    it('returns null when there is no live opportunity for the customer', async () => {
        Conversation.findOne = jest.fn().mockResolvedValue(row());
        pilotFeatures.isCustomerIntelligenceEnabled.mockResolvedValue(true);
        opportunityService.liveOpportunitiesForCustomers.mockResolvedValue(new Map());

        const result = await conversationService.getConversationById('conv-1', 'shop-1');

        expect(result.open_opportunity).toBeNull();
    });
});
