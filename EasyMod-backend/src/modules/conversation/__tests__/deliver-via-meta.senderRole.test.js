/**
 * deliver-via-meta.senderRole.test.js
 *
 * Regression test for a bug found during independent review of the
 * human-agent-outside-window policy fix: deliverViaMetaIfApplicable()
 * hardcoded senderRole: 'agent' for every caller, including the automated
 * HITL-escalation holding message (updateConversation's `hitl: true`
 * branch), which is not a human-typed reply. That message would then be
 * silently blocked by templateRequired.rule's human-agent-outside-window
 * gate instead of being tagged and delivered like other automated sends.
 *
 * This tests only the senderRole threading — window/tag logic itself is
 * covered by rules.test.js.
 */

'use strict';

process.env.NODE_ENV = 'test';

const conversation = { id: 'conv-1', shop_id: 'shop-1', channel: 'facebook', meta_channel_id: null, customer: { channel_user_id: 'psid-1' } };
const metaChannel = { id: 'channel-1', shop_id: 'shop-1', status: 'CONNECTED' };

jest.mock('../../entities', () => ({
    Conversation: { findOne: jest.fn() },
    Customer: {},
    Message: {},
}));
jest.mock('../../channel-providers/meta-channel.service', () => ({
    findByShopAndPlatform: jest.fn(),
}));
jest.mock('../../channel-providers/meta-channel.entity', () => ({ findByPk: jest.fn() }));
jest.mock('../../channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('../../policy/policy.engine', () => ({ evaluateOutbound: jest.fn() }));
jest.mock('../../../utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('../../../config/redis', () => ({ cacheRedis: { setex: jest.fn(), del: jest.fn() } }));

const { Conversation } = require('../../entities');
const metaChannelService = require('../../channel-providers/meta-channel.service');
const policyEngine = require('../../policy/policy.engine');
const { getProvider } = require('../../channel-providers/provider.registry');
const controller = require('../conversation.controller');

describe('deliverViaMetaIfApplicable — senderRole threading', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Conversation.findOne.mockResolvedValue(conversation);
        metaChannelService.findByShopAndPlatform.mockResolvedValue(metaChannel);
        policyEngine.evaluateOutbound.mockResolvedValue({ allow: true, transform: null });
        getProvider.mockReturnValue({ sendMessage: jest.fn().mockResolvedValue({ providerMessageId: 'mid_1' }) });
    });

    test('defaults to senderRole "agent" for a real human-typed reply (unchanged behavior)', async () => {
        await controller._deliverViaMetaIfApplicable('conv-1', 'shop-1', { content: 'hello', id: 'm1' });

        expect(policyEngine.evaluateOutbound).toHaveBeenCalledWith(
            expect.objectContaining({ senderRole: 'agent' }),
            expect.anything(),
        );
    });

    test('threads an explicit senderRole "ai" for the automated escalation holding message', async () => {
        await controller._deliverViaMetaIfApplicable('conv-1', 'shop-1', 'We will get back to you shortly', 'ai');

        expect(policyEngine.evaluateOutbound).toHaveBeenCalledWith(
            expect.objectContaining({ senderRole: 'ai' }),
            expect.anything(),
        );
    });

    test('a policy denial specific to senderRole="agent" does not affect an "ai"-tagged send', async () => {
        // Simulate templateRequired.rule's real behavior: deny agent sends
        // outside the window, allow ai sends. If the escalation call site
        // regressed back to hardcoding 'agent', this would start failing.
        policyEngine.evaluateOutbound.mockImplementation(async (message) => {
            if (message.senderRole === 'agent') {
                return { allow: false, reason: 'HUMAN_AGENT_OUTSIDE_WINDOW_BLOCKED' };
            }
            return { allow: true, transform: null };
        });

        const provider = { sendMessage: jest.fn().mockResolvedValue({ providerMessageId: 'mid_2' }) };
        getProvider.mockReturnValue(provider);

        await controller._deliverViaMetaIfApplicable('conv-1', 'shop-1', 'holding message', 'ai');

        expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    });
});
