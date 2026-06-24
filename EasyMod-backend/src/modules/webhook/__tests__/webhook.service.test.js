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
 *   3. maps legacy instagram channel type to facebook (FB-only launch)
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
    findByPk: jest.fn().mockResolvedValue(mockMetaChannel),
}));

// Customer is now looked up in the shim so the policy engine has opt-out context.
jest.mock('../../customer/customer.entity', () => ({
    findOne: jest.fn().mockResolvedValue(null),
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
const Customer = require('../../customer/customer.entity');
const { getProvider } = require('../../channel-providers/provider.registry');
const policyEngine = require('../../policy/policy.engine');
const { sendMessage, sendToCustomer } = require('../webhook.service');

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

    test('maps a legacy instagram channel type to facebook (FB-only launch)', async () => {
        mockSendMessage.mockResolvedValueOnce({});

        await sendMessage(buildChannel({ type: 'instagram' }), 'legacy-id', 'msg');

        // Instagram is removed: normalizePlatform collapses any channel type to
        // 'facebook', so the lookup and send go through the Facebook provider.
        expect(MetaChannel.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ platform: 'facebook' }) })
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
        // No meta_channel_id on the channel → goes straight to findOne fallback.
        MetaChannel.findOne.mockResolvedValueOnce(null);
        await sendMessage(buildChannel(), 'psid', 'msg');
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    // Phase 2 — explicit meta_channel_id routing
    test('uses findByPk when channel.meta_channel_id is provided', async () => {
        mockSendMessage.mockResolvedValueOnce({});
        await sendMessage(buildChannel({ meta_channel_id: 'mc-explicit' }), 'psid', 'msg');

        expect(MetaChannel.findByPk).toHaveBeenCalledWith('mc-explicit');
        expect(MetaChannel.findOne).not.toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalled();
    });

    test('falls back to findOne when findByPk returns null for stale meta_channel_id', async () => {
        MetaChannel.findByPk.mockResolvedValueOnce(null);
        mockSendMessage.mockResolvedValueOnce({});

        await sendMessage(buildChannel({ meta_channel_id: 'mc-deleted' }), 'psid', 'msg');

        expect(MetaChannel.findByPk).toHaveBeenCalledWith('mc-deleted');
        expect(MetaChannel.findOne).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalled();
    });
});

// ── sendToCustomer: resolve a Customer record → PSID + platform, then send ─────
// Regression coverage for the silent-notification bug: callers (order/delivery/
// payment) used to look up an undefined `Channel` model and pass a phone or an
// internal customer UUID as the recipient. sendToCustomer resolves the real
// channel_user_id (PSID/IGSID) and the customer's platform.
describe('sendToCustomer (resolve PSID from a customer record)', () => {
    const buildCustomer = (overrides = {}) => ({
        id: 'cust-uuid-1',
        shop_id: 'shop-uuid-1234',
        channel_type: 'messenger',
        channel_user_id: 'psid-cust-9',
        ...overrides,
    });

    test('resolves the customer PSID and sends via the customer platform', async () => {
        Customer.findOne.mockResolvedValue(buildCustomer());
        mockSendMessage.mockResolvedValueOnce({});

        const result = await sendToCustomer({
            shopId: 'shop-uuid-1234',
            customerId: 'cust-uuid-1',
            message: 'Your order shipped',
        });

        // The recipient must be the channel_user_id (PSID) — NOT the customer UUID or a phone.
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            recipientId: 'psid-cust-9',
            normalizedMessage: expect.objectContaining({ text: 'Your order shipped' }),
        }));
        expect(result).toEqual(expect.objectContaining({ sent: true, recipientId: 'psid-cust-9' }));
    });

    test('maps a legacy instagram customer to a facebook send (FB-only launch)', async () => {
        Customer.findOne.mockResolvedValue(buildCustomer({ channel_type: 'instagram', channel_user_id: 'legacy-7' }));
        mockSendMessage.mockResolvedValueOnce({});

        await sendToCustomer({ shopId: 'shop-uuid-1234', customerId: 'cust-uuid-1', message: 'hi' });

        // Instagram removed: the send resolves to the Facebook provider regardless
        // of the customer's legacy channel_type, using their stored channel_user_id.
        expect(MetaChannel.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ platform: 'facebook' }) })
        );
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'legacy-7' }));
    });

    test('returns no_customer when the customer is not found', async () => {
        Customer.findOne.mockResolvedValue(null);
        const result = await sendToCustomer({ shopId: 'shop-uuid-1234', customerId: 'missing', message: 'hi' });
        expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'no_customer_psid' }));
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('returns no_customer_psid when the customer has no channel_user_id', async () => {
        Customer.findOne.mockResolvedValue(buildCustomer({ channel_user_id: null }));
        const result = await sendToCustomer({ shopId: 'shop-uuid-1234', customerId: 'cust-uuid-1', message: 'hi' });
        expect(result).toEqual(expect.objectContaining({ sent: false, reason: 'no_customer_psid' }));
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('returns missing_args when required args are absent', async () => {
        const r1 = await sendToCustomer({ shopId: null, customerId: 'c', message: 'hi' });
        const r2 = await sendToCustomer({ shopId: 's', customerId: null, message: 'hi' });
        const r3 = await sendToCustomer({ shopId: 's', customerId: 'c', message: '' });
        expect(r1).toEqual(expect.objectContaining({ sent: false, reason: 'missing_args' }));
        expect(r2).toEqual(expect.objectContaining({ sent: false, reason: 'missing_args' }));
        expect(r3).toEqual(expect.objectContaining({ sent: false, reason: 'missing_args' }));
        expect(mockSendMessage).not.toHaveBeenCalled();
    });
});
