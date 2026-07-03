'use strict';

/**
 * human-handoff.service — escalateToHuman() shared by the sentiment
 * auto-escalation and the low-confidence handoff paths in the message worker.
 */

process.env.NODE_ENV = 'test';

jest.mock('src/utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('src/modules/channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('src/modules/conversation/escalation-auto-reply.service', () => ({
    sendEscalationAutoReply: jest.fn(),
}));
jest.mock('src/modules/policy/policy.engine', () => ({
    evaluateOutbound: jest.fn(),
}));
jest.mock('src/modules/entities', () => ({
    Customer: { findOne: jest.fn() },
    MetaChannelSettings: { findOne: jest.fn() },
}));

const sseManager = require('src/utils/sse-manager');
const { getProvider } = require('src/modules/channel-providers/provider.registry');
const { sendEscalationAutoReply } = require('src/modules/conversation/escalation-auto-reply.service');
const policyEngine = require('src/modules/policy/policy.engine');
const { Customer, MetaChannelSettings } = require('src/modules/entities');
const { escalateToHuman } = require('src/modules/conversation/human-handoff.service');

describe('escalateToHuman', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Customer.findOne.mockResolvedValue({ id: 'cust-1' });
        MetaChannelSettings.findOne.mockResolvedValue({ channel_id: 'ch1' });
        policyEngine.evaluateOutbound.mockResolvedValue({
            allow: true,
            reason: 'OK',
            augment: {},
            transform: null,
        });
    });

    test('sets hitl=true, emits hitl_changed, and delivers a holding message to the customer', async () => {
        const conversation = { id: 'c1', hitl: false, update: jest.fn().mockResolvedValue() };
        const send = jest.fn().mockResolvedValue();
        getProvider.mockReturnValue({ sendMessage: send });
        sendEscalationAutoReply.mockResolvedValue({ id: 'm1', content: 'hold on', conversation_id: 'c1' });

        await escalateToHuman({
            conversation, shopId: 's1', conversationId: 'c1',
            platform: 'messenger', recipientId: 123, channel: { id: 'ch1' }, reason: 'low_confidence',
        });

        expect(conversation.update).toHaveBeenCalledWith({ hitl: true });
        expect(sseManager.emit).toHaveBeenCalledWith('s1', 'hitl_changed', { conversation_id: 'c1', hitl: true });
        expect(sendEscalationAutoReply).toHaveBeenCalledWith('c1', 's1');
        expect(send).toHaveBeenCalledTimes(1);
        const arg = send.mock.calls[0][0];
        expect(arg.normalizedMessage.text).toBe('hold on');
        expect(arg.normalizedMessage.platform).toBe('facebook'); // messenger normalizes to facebook
        expect(arg.recipientId).toBe('123');
        expect(policyEngine.evaluateOutbound).toHaveBeenCalledWith(
            expect.objectContaining({ text: 'hold on', platform: 'facebook', senderRole: 'ai' }),
            expect.objectContaining({
                shopId: 's1',
                channelId: 'ch1',
                conversationId: 'c1',
                recipientId: '123',
                platform: 'facebook',
            }),
        );
        expect(arg.decision.reason).toBe('OK');
    });

    test('does not flip hitl again when already true (idempotent), still reassures', async () => {
        const conversation = { id: 'c1', hitl: true, update: jest.fn().mockResolvedValue() };
        getProvider.mockReturnValue({ sendMessage: jest.fn().mockResolvedValue() });
        sendEscalationAutoReply.mockResolvedValue({ id: 'm1', content: 'hold on' });

        await escalateToHuman({
            conversation, shopId: 's1', conversationId: 'c1',
            platform: 'instagram', recipientId: 1, channel: { id: 'ch1' },
        });

        expect(conversation.update).not.toHaveBeenCalled();
        expect(sendEscalationAutoReply).toHaveBeenCalled();
    });

    test('never throws when holding-message delivery fails', async () => {
        const conversation = { id: 'c1', hitl: false, update: jest.fn().mockResolvedValue() };
        getProvider.mockReturnValue({ sendMessage: jest.fn().mockRejectedValue(new Error('meta down')) });
        sendEscalationAutoReply.mockResolvedValue({ id: 'm1', content: 'hold on' });

        await expect(escalateToHuman({
            conversation, shopId: 's1', conversationId: 'c1',
            platform: 'instagram', recipientId: 1, channel: { id: 'ch1' },
        })).resolves.not.toThrow();
    });

    test('does not deliver the holding message when policy blocks it', async () => {
        const conversation = { id: 'c1', hitl: false, update: jest.fn().mockResolvedValue() };
        const send = jest.fn().mockResolvedValue();
        getProvider.mockReturnValue({ sendMessage: send });
        sendEscalationAutoReply.mockResolvedValue({ id: 'm1', content: 'hold on' });
        policyEngine.evaluateOutbound.mockResolvedValue({
            allow: false,
            reason: 'OPTED_OUT',
            augment: {},
        });

        await escalateToHuman({
            conversation, shopId: 's1', conversationId: 'c1',
            platform: 'messenger', recipientId: 123, channel: { id: 'ch1' },
        });

        expect(policyEngine.evaluateOutbound).toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    test('skips provider delivery when no channel could be resolved', async () => {
        const conversation = { id: 'c1', hitl: false, update: jest.fn().mockResolvedValue() };
        sendEscalationAutoReply.mockResolvedValue({ id: 'm1', content: 'hold on' });

        await escalateToHuman({
            conversation, shopId: 's1', conversationId: 'c1',
            platform: 'messenger', recipientId: 1, channel: null,
        });

        expect(getProvider).not.toHaveBeenCalled();
    });
});
