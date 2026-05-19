'use strict';

/**
 * Tests for src/modules/webhook/webhook.service.js
 *
 * Phase 5 rewrite: shim delegates to providerRegistry + MetaChannel lookup.
 * All DB and provider calls are mocked — no real HTTP calls.
 *
 * Test cases preserved from the pre-Phase-5 suite:
 *   1. delegates to provider.sendMessage with correct args
 *   2. maps facebook channel type to facebook platform (provider key)
 *   3. passes instagram platform unchanged
 *   4. does nothing if channel is missing
 *   5. does nothing if recipientId is missing
 *   6. does nothing if message is missing
 *   7. re-throws errors from provider.sendMessage
 *   8. converts numeric recipientId to string
 */

// ── Mock MetaChannel ─────────────────────────────────────────────────────────
const mockMetaChannel = {
    id: 'mc-1',
    shop_id: 'shop-uuid-1234',
    platform: 'facebook',
    status: 'CONNECTED',
};

jest.mock('../../channel-providers/meta-channel.entity', () => ({
    findOne: jest.fn().mockResolvedValue(mockMetaChannel),
}));

// ── Mock provider registry ───────────────────────────────────────────────────
const mockSendMessage = jest.fn();

jest.mock('../../channel-providers/provider.registry', () => ({
    getProvider: jest.fn(() => ({ sendMessage: mockSendMessage })),
}));

// ── Mock policy engine — always allow ────────────────────────────────────────
jest.mock('../../policy/policy.engine', () => ({
    evaluateOutbound: jest.fn().mockResolvedValue({
        allow: true,
        reason: 'OK',
        transform: null,
        augment: {},
        decisionId: 'dec-1',
    }),
}));

const MetaChannel = require('../../channel-providers/meta-channel.entity');
const { getProvider } = require('../../channel-providers/provider.registry');
const policyEngine = require('../../policy/policy.engine');
const { sendMessage } = require('../webhook.service');

// ── Helpers ──────────────────────────────────────────────────────────────────
const buildChannel = (overrides = {}) => ({
    shop_id: 'shop-uuid-1234',
    type: 'facebook',
    is_active: true,
    ...overrides,
});

afterEach(() => jest.clearAllMocks());

describe('sendMessage (webhook shim — Phase 5)', () => {

    test('delegates to provider.sendMessage with correct args', async () => {
        mockSendMessage.mockResolvedValueOnce({});

        const channel = buildChannel();
        await sendMessage(channel, 'psid-123', 'Hello customer');

        expect(MetaChannel.findOne).toHaveBeenCalledTimes(1);
        expect(MetaChannel.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: { shop_id: 'shop-uuid-1234', platform: 'facebook' } })
        );
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            channel: mockMetaChannel,
            recipientId: 'psid-123',
            normalizedMessage: expect.objectContaining({ text: 'Hello customer' }),
        }));
    });

    test('maps facebook channel type to facebook platform', async () => {
        mockSendMessage.mockResolvedValueOnce({});
        await sendMessage(buildChannel({ type: 'facebook' }), 'psid', 'msg');

        expect(MetaChannel.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ platform: 'facebook' }) })
        );
        expect(mockSendMessage).toHaveBeenCalled();
    });

    test('maps messenger channel type to facebook platform', async () => {
        mockSendMessage.mockResolvedValueOnce({});
        await sendMessage(buildChannel({ type: 'messenger' }), 'psid', 'msg');

        expect(MetaChannel.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ platform: 'facebook' }) })
        );
        expect(mockSendMessage).toHaveBeenCalled();
    });

    test('passes instagram platform unchanged', async () => {
        // Make findOne return an IG channel for this test
        MetaChannel.findOne.mockResolvedValueOnce({ ...mockMetaChannel, platform: 'instagram' });
        mockSendMessage.mockResolvedValueOnce({});

        await sendMessage(buildChannel({ type: 'instagram' }), 'ig-scoped-id', 'msg');

        expect(MetaChannel.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ platform: 'instagram' }) })
        );
        expect(mockSendMessage).toHaveBeenCalled();
    });

    test('does not call provider.sendMessage if channel is missing', async () => {
        await sendMessage(null, 'psid', 'msg');
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('does not call provider.sendMessage if recipientId is missing', async () => {
        await sendMessage(buildChannel(), null, 'msg');
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('does not call provider.sendMessage if message is missing', async () => {
        await sendMessage(buildChannel(), 'psid', '');
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('re-throws errors from provider.sendMessage', async () => {
        mockSendMessage.mockRejectedValueOnce(new Error('Meta API error'));
        await expect(sendMessage(buildChannel(), 'psid', 'msg')).rejects.toThrow('Meta API error');
    });

    test('converts numeric recipientId to string', async () => {
        mockSendMessage.mockResolvedValueOnce({});
        await sendMessage(buildChannel(), 12345, 'msg');
        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ recipientId: '12345' })
        );
    });

    test('drops send silently when no MetaChannel found for shop+platform', async () => {
        MetaChannel.findOne.mockResolvedValueOnce(null);
        await sendMessage(buildChannel(), 'psid', 'msg');
        expect(mockSendMessage).not.toHaveBeenCalled();
    });
});
