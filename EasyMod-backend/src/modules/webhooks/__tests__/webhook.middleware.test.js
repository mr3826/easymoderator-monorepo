'use strict';

const crypto = require('crypto');
const { validateBkashSignature } = require('../webhook.middleware');

describe('bKash verified system mutation context', () => {
    const previousSecret = process.env.BKASH_WEBHOOK_SECRET;

    beforeEach(() => {
        process.env.BKASH_WEBHOOK_SECRET = 'integration-test-webhook-secret';
    });

    afterAll(() => {
        if (previousSecret === undefined) delete process.env.BKASH_WEBHOOK_SECRET;
        else process.env.BKASH_WEBHOOK_SECRET = previousSecret;
    });

    test('marks the request with verified signature and event identity after HMAC validation', async () => {
        const body = { paymentID: 'payment-test-1', trxID: 'transaction-test-1' };
        const rawBody = Buffer.from(JSON.stringify(body));
        const signature = crypto.createHmac('sha256', process.env.BKASH_WEBHOOK_SECRET).update(rawBody).digest('hex');
        const req = {
            body,
            rawBody,
            headers: { 'x-bkash-signature': signature },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await validateBkashSignature(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.webhookSignatureVerified).toBe(true);
        expect(req.webhookSignatureSource).toBe('bkash');
        expect(req.webhookEventId).toBe('payment-test-1');
    });
});
