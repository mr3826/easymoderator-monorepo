'use strict';

/**
 * Tests for src/modules/webhook/webhook.service.js (compatibility shim)
 *
 * The shim wraps sendWithRateLimit from meta-send.service.js.
 * All Meta API calls are mocked — no real HTTP calls.
 */

jest.mock('../../integration/meta-send.service', () => ({
    sendWithRateLimit: jest.fn()
}));

const { sendWithRateLimit } = require('../../integration/meta-send.service');
const { sendMessage } = require('../webhook.service');

const buildChannel = (overrides = {}) => ({
    shop_id: 'shop-uuid-1234',
    type: 'facebook',
    is_active: true,
    ...overrides
});

afterEach(() => jest.clearAllMocks());

describe('sendMessage (webhook shim)', () => {
    test('delegates to sendWithRateLimit with correct args', async () => {
        sendWithRateLimit.mockResolvedValueOnce({});

        const channel = buildChannel();
        await sendMessage(channel, 'psid-123', 'Hello customer');

        expect(sendWithRateLimit).toHaveBeenCalledTimes(1);
        expect(sendWithRateLimit).toHaveBeenCalledWith({
            shopId: 'shop-uuid-1234',
            platform: 'messenger',
            recipientId: 'psid-123',
            message: 'Hello customer'
        });
    });

    test('maps facebook channel type to messenger platform', async () => {
        sendWithRateLimit.mockResolvedValueOnce({});
        await sendMessage(buildChannel({ type: 'facebook' }), 'psid', 'msg');
        expect(sendWithRateLimit).toHaveBeenCalledWith(expect.objectContaining({ platform: 'messenger' }));
    });

    test('passes instagram platform unchanged', async () => {
        sendWithRateLimit.mockResolvedValueOnce({});
        await sendMessage(buildChannel({ type: 'instagram' }), 'ig-scoped-id', 'msg');
        expect(sendWithRateLimit).toHaveBeenCalledWith(expect.objectContaining({ platform: 'instagram' }));
    });

    test('does not call sendWithRateLimit if channel is missing', async () => {
        await sendMessage(null, 'psid', 'msg');
        expect(sendWithRateLimit).not.toHaveBeenCalled();
    });

    test('does not call sendWithRateLimit if recipientId is missing', async () => {
        await sendMessage(buildChannel(), null, 'msg');
        expect(sendWithRateLimit).not.toHaveBeenCalled();
    });

    test('does not call sendWithRateLimit if message is missing', async () => {
        await sendMessage(buildChannel(), 'psid', '');
        expect(sendWithRateLimit).not.toHaveBeenCalled();
    });

    test('re-throws errors from sendWithRateLimit', async () => {
        sendWithRateLimit.mockRejectedValueOnce(new Error('Meta API error'));
        await expect(sendMessage(buildChannel(), 'psid', 'msg')).rejects.toThrow('Meta API error');
    });

    test('converts numeric recipientId to string', async () => {
        sendWithRateLimit.mockResolvedValueOnce({});
        await sendMessage(buildChannel(), 12345, 'msg');
        expect(sendWithRateLimit).toHaveBeenCalledWith(expect.objectContaining({ recipientId: '12345' }));
    });
});
