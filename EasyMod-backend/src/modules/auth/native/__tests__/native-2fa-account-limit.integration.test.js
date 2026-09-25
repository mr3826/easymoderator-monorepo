'use strict';

const request = require('supertest');
// The helpers enable the mobile API before the app and config load, so they are required first.
const {
    PASSWORD,
    app,
    currentCode,
    invalidCode,
    issueChallenge,
    cleanupFixtures,
} = require('./native-2fa.integration.helpers');
const { Session } = require('../../../entities');

// The per-IP limiter on /2fa/verify cannot stop guesses spread across many
// client IPs. Each guess already costs a password sign-in (the challenge is
// single-use), so the remaining boundary is per account: five failed codes in
// the window lock that account's native 2FA verification, whatever the IP.

let nextIp = 1;
const freshIp = () => `198.51.100.${nextIp++}`;

async function newChallenge(fixture) {
    const signin = await request(app)
        .post('/api/auth/native/signin')
        .set('X-Forwarded-For', freshIp())
        .send({ email: fixture.user.email, password: PASSWORD });
    expect(signin.status).toBe(200);
    expect(signin.body.data.requires2fa).toBe(true);
    return signin.body.data.tempToken;
}

const verify = (tempToken, token) => request(app)
    .post('/api/auth/native/2fa/verify')
    .set('X-Forwarded-For', freshIp())
    .send({ tempToken, token });

async function failVerification(fixture, secret, times) {
    for (let attempt = 0; attempt < times; attempt += 1) {
        const response = await verify(await newChallenge(fixture), invalidCode(secret));
        expect(response.status).toBe(400);
    }
}

describe('native 2FA per-account failure limit', () => {
    // Production trusts one proxy hop (app.js), so req.ip is each real client's
    // address; the same setting here lets X-Forwarded-For model distinct clients.
    beforeAll(() => {
        app.set('trust proxy', 1);
    });

    afterAll(async () => {
        app.set('trust proxy', false);
        await cleanupFixtures();
    });

    test('locks the account after five failed codes, even from five different IPs, and issues no session', async () => {
        const { fixture, secret, tempToken } = await issueChallenge('account-limit');
        const first = await verify(tempToken, invalidCode(secret));
        expect(first.status).toBe(400);
        await failVerification(fixture, secret, 4);

        const locked = await verify(await newChallenge(fixture), currentCode(secret, 1));

        expect(locked.status).toBe(429);
        expect(locked.body.error?.code || locked.body.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(await Session.count({ where: { user_id: fixture.user.id, is_active: true } })).toBe(0);
    });

    test('a correct code below the limit succeeds and resets the failure count', async () => {
        const { fixture, secret, tempToken } = await issueChallenge('account-reset');
        const first = await verify(tempToken, invalidCode(secret));
        expect(first.status).toBe(400);
        await failVerification(fixture, secret, 3);

        const success = await verify(await newChallenge(fixture), currentCode(secret, 1));
        expect(success.status).toBe(200);

        // The count restarted: four more failures still leave one attempt.
        await failVerification(fixture, secret, 4);
        const again = await verify(await newChallenge(fixture), currentCode(secret, -1));
        expect(again.status).toBe(200);
    });

    test('the lock is per account: another account is unaffected', async () => {
        const locked = await issueChallenge('account-locked');
        const first = await verify(locked.tempToken, invalidCode(locked.secret));
        expect(first.status).toBe(400);
        await failVerification(locked.fixture, locked.secret, 4);

        const other = await issueChallenge('account-other');
        const response = await verify(other.tempToken, currentCode(other.secret, 1));
        expect(response.status).toBe(200);
    });
});
