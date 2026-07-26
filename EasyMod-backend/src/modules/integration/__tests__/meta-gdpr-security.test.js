'use strict';

process.env.NODE_ENV = 'test';

const mockProcessDeletionRequest = jest.fn();
const mockGetDeletionStatus = jest.fn();
const mockProcessDeauthorization = jest.fn();

jest.mock('../meta-compliance.service', () => ({
    processDeletionRequest: mockProcessDeletionRequest,
    getDeletionStatus: mockGetDeletionStatus,
}));
jest.mock('../../channel-providers/meta-authorization-recovery.service', () => ({
    processDeauthorization: mockProcessDeauthorization,
}));
jest.mock('../../../config/config', () => ({ metaAppSecret: 'x'.repeat(64) }));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const router = require('../meta-webhook-gdpr.handler');
const { parseSignedRequest } = router._private;

function sign(payload, secret = 'x'.repeat(64)) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${signature}.${encoded}`;
}

function validPayload(overrides = {}) {
    return {
        algorithm: 'HMAC-SHA256',
        user_id: 'app-user-123',
        issued_at: Math.floor(Date.now() / 1000),
        ...overrides,
    };
}

describe('Meta GDPR signed requests and callback truthfulness', () => {
    const app = express();
    app.use('/api/webhooks/meta', router);

    beforeEach(() => jest.clearAllMocks());

    test('accepts a current authentic signed request', () => {
        expect(parseSignedRequest(sign(validPayload()), 'x'.repeat(64)))
            .toMatchObject({ user_id: 'app-user-123' });
    });

    test('rejects invalid, malformed, wrong-algorithm, and expired requests', () => {
        expect(parseSignedRequest(sign(validPayload()), 'wrong')).toBeNull();
        expect(parseSignedRequest('not-a-signed-request', 'x'.repeat(64))).toBeNull();
        expect(parseSignedRequest(sign(validPayload({ algorithm: 'none' })), 'x'.repeat(64)))
            .toBeNull();
        expect(parseSignedRequest(sign(validPayload({
            issued_at: Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000),
        })), 'x'.repeat(64))).toBeNull();
    });

    test('returns Meta confirmation format only when processing succeeds', async () => {
        mockProcessDeletionRequest.mockResolvedValue({
            confirmationCode: `DEL-${'a'.repeat(32)}`,
        });
        const response = await request(app)
            .post('/api/webhooks/meta/data-deletion')
            .type('form')
            .send({ signed_request: sign(validPayload()) })
            .expect(200);
        expect(response.body.confirmation_code).toMatch(/^DEL-/);
        expect(response.body.url).toContain('/data-deletion/status/');
    });

    test('does not report false success when deletion fails', async () => {
        mockProcessDeletionRequest.mockRejectedValue(new Error('database failed'));
        const response = await request(app)
            .post('/api/webhooks/meta/data-deletion')
            .type('form')
            .send({ signed_request: sign(validPayload()) })
            .expect(500);
        expect(response.body.confirmation_code).toBeUndefined();
    });

    test('exposes honest completed, unresolved, and missing status', async () => {
        mockGetDeletionStatus.mockResolvedValueOnce({ status: 'completed', retryable: false });
        await request(app)
            .get(`/api/webhooks/meta/data-deletion/status/DEL-${'a'.repeat(32)}`)
            .expect(200, { status: 'completed', retryable: false });
        mockGetDeletionStatus.mockResolvedValueOnce({
            status: 'identity_not_resolved',
            retryable: true,
            matched_customers: 0,
        });
        await request(app)
            .get(`/api/webhooks/meta/data-deletion/status/DEL-${'b'.repeat(32)}`)
            .expect(200, {
                status: 'identity_not_resolved',
                retryable: true,
                matched_customers: 0,
            });
        mockGetDeletionStatus.mockResolvedValueOnce(null);
        await request(app)
            .get(`/api/webhooks/meta/data-deletion/status/DEL-${'c'.repeat(32)}`)
            .expect(404);
    });

    test('deauthorization validates the callback before recovery', async () => {
        mockProcessDeauthorization.mockResolvedValue({ channelsDisabled: 2 });
        await request(app)
            .post('/api/webhooks/meta/deauthorize')
            .type('form')
            .send({ signed_request: sign(validPayload()) })
            .expect(200);
        expect(mockProcessDeauthorization).toHaveBeenCalledWith('app-user-123');

        await request(app)
            .post('/api/webhooks/meta/deauthorize')
            .type('form')
            .send({ signed_request: 'invalid' })
            .expect(403);
        expect(mockProcessDeauthorization).toHaveBeenCalledTimes(1);
    });
});
