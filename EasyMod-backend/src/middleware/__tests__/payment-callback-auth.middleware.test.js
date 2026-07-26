'use strict';

const crypto = require('crypto');

const mockConfig = {
    env: 'production',
    paymentGatewayIpAllowlist: ['203.0.113.10'],
    paymentCallbackHmacSecret: 'a'.repeat(64),
};
jest.mock('../../config/config', () => mockConfig);

const {
    paymentCallbackHmacVerify,
    paymentGatewayIpAllowlist,
} = require('../payment-callback-auth.middleware');

function response() {
    return {};
}

describe('payment callback authentication', () => {
    test('does not trust a forged X-Forwarded-For header', () => {
        const next = jest.fn();
        paymentGatewayIpAllowlist({
            ip: '198.51.100.20',
            headers: { 'x-forwarded-for': '203.0.113.10' },
            socket: {},
        }, response(), next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    });

    test('requires HMAC in production and handles length mismatch safely', () => {
        const original = mockConfig.paymentCallbackHmacSecret;
        mockConfig.paymentCallbackHmacSecret = '';
        const missingSecretNext = jest.fn();
        paymentCallbackHmacVerify({ headers: {}, body: {} }, response(), missingSecretNext);
        expect(missingSecretNext).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));

        mockConfig.paymentCallbackHmacSecret = original;
        const malformedNext = jest.fn();
        expect(() => paymentCallbackHmacVerify({
            headers: { 'x-payment-hmac-sha256': '00' },
            rawBody: Buffer.from('{}'),
        }, response(), malformedNext)).not.toThrow();
        expect(malformedNext).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    });

    test('accepts an authentic raw-body HMAC', () => {
        const rawBody = Buffer.from('{"paymentID":"p1"}');
        const signature = crypto.createHmac('sha256', mockConfig.paymentCallbackHmacSecret)
            .update(rawBody)
            .digest('hex');
        const next = jest.fn();
        paymentCallbackHmacVerify({
            headers: { 'x-payment-hmac-sha256': signature },
            rawBody,
        }, response(), next);
        expect(next).toHaveBeenCalledWith();
    });
});
