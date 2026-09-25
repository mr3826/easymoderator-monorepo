'use strict';

const request = require('supertest');
const {
    app,
    totpService,
    currentCode,
    invalidCode,
    issueChallenge,
    cleanupFixtures,
} = require('./native-2fa.integration.helpers');

describe('native 2FA challenge security', () => {
    afterAll(async () => {
        await cleanupFixtures();
    });

    test('invalid code consumes the challenge and replay is rejected', async () => {
        const challenge = await issueChallenge('invalid-replay');
        const invalid = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: challenge.tempToken, token: invalidCode(challenge.secret) });

        expect(invalid.status).toBe(400);

        const replay = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: challenge.tempToken, token: currentCode(challenge.secret) });

        expect(replay.status).toBe(401);
        expect(replay.body.message || replay.body.error?.message).toMatch(/invalid or expired/i);
    });

    test('an unavailable or expired challenge fails closed before code verification', async () => {
        const challenge = await issueChallenge('expired');
        const consumedUserId = await totpService.consumeTempToken(challenge.tempToken);
        expect(consumedUserId).toBe(challenge.fixture.user.id);

        const response = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: challenge.tempToken, token: currentCode(challenge.secret) });

        expect(response.status).toBe(401);
        expect(response.body.message || response.body.error?.message).toMatch(/invalid or expired/i);
    });

    test('a challenge cannot be verified with another user account code', async () => {
        const first = await issueChallenge('user-a');
        const second = await issueChallenge('user-b');

        const response = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: first.tempToken, token: currentCode(second.secret) });

        expect(response.status).toBe(400);
        expect(response.body.message || response.body.error?.message).toMatch(/invalid|token/i);

        const replay = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: first.tempToken, token: currentCode(first.secret) });
        expect(replay.status).toBe(401);
    });
});
