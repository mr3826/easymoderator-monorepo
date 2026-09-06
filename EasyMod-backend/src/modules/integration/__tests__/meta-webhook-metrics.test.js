'use strict';

const crypto = require('crypto');

const mockLogCalls = [];
jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        warn: (...args) => mockLogCalls.push(args),
    })),
}));

let metrics;

beforeEach(() => {
    jest.resetModules();
    metrics = require('../meta-webhook-metrics');
    mockLogCalls.length = 0;
});

describe('safe malformed Meta webhook metrics', () => {
    test('records only a count and timestamp in the exposed snapshot', () => {
        const rawBody = Buffer.from('{"message":"customer text","sender":"psid-secret"}');

        metrics.recordMalformedWebhook({
            rawBody,
            signatureValid: true,
            code: 'INVALID_JSON',
        });

        const snapshot = metrics.getMalformedWebhookMetrics();
        expect(Object.keys(snapshot)).toEqual(['count', 'lastAt']);
        expect(snapshot.count).toBe(1);
        expect(typeof snapshot.lastAt).toBe('string');
        expect(Number.isNaN(Date.parse(snapshot.lastAt))).toBe(false);
    });

    test('logs bounded body diagnostics without raw body, message, PSID, or secret', () => {
        const rawBody = Buffer.from('{"message":"customer text","sender":"psid-secret"}');
        const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');

        metrics.recordMalformedWebhook({
            rawBody,
            signatureValid: false,
            code: 'INVALID_ENVELOPE',
        });

        expect(mockLogCalls).toHaveLength(1);
        expect(mockLogCalls[0][0]).toBe('Malformed Meta webhook payload');
        expect(mockLogCalls[0][1]).toEqual({
            bodySize: rawBody.length,
            bodyHash,
            signatureValid: false,
            code: 'INVALID_ENVELOPE',
        });

        const serialized = JSON.stringify(mockLogCalls);
        expect(serialized).not.toContain(rawBody.toString());
        expect(serialized).not.toContain('customer text');
        expect(serialized).not.toContain('psid-secret');
    });
});

describe('receipt claim conflict metrics', () => {
    test('records a bounded conflict count and timestamp', () => {
        metrics.recordReceiptClaimConflict({
            pageId: 'page-1',
            receiptId: 'receipt-1',
            status: 'PROCESSING',
        });

        const snapshot = metrics.getReceiptClaimConflictMetrics();
        expect(snapshot.count).toBe(1);
        expect(Number.isNaN(Date.parse(snapshot.lastAt))).toBe(false);
        expect(mockLogCalls[0]).toEqual([
            'Meta webhook receipt claim lost to another processor',
            { pageId: 'page-1', receiptId: 'receipt-1', status: 'PROCESSING' },
        ]);
    });
});
