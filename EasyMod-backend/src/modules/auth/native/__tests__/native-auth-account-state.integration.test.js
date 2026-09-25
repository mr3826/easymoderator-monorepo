'use strict';

const request = require('supertest');
// The helpers enable the mobile API before the app and config load, so they are required first.
const {
    PASSWORD,
    app,
    currentCode,
    issueChallenge,
    cleanupFixtures,
} = require('./native-2fa.integration.helpers');
const { User, Session, GrowthOsUserRole } = require('../../../entities');
const { invalidateUserSessions } = require('../../session-invalidation.service');

// main and feature/mobile-app both changed sign-in. main added temporary
// (invite/reset) passwords that must be changed before a session can do
// anything else, token-generation-bound 2FA challenges, and shop-less sessions
// for Growth OS staff. Native sign-in reuses the same resolver, so each of
// those rules has to hold on the native path too.

const nativeSignin = (email) => request(app)
    .post('/api/auth/native/signin')
    .send({ email, password: PASSWORD });

const nativeVerify = (tempToken, token) => request(app)
    .post('/api/auth/native/2fa/verify')
    .send({ tempToken, token });

const errorCode = (response) => response.body.error?.code || response.body.code;

async function withTemporaryPassword(user, expiresInMs) {
    await user.update({
        must_change_password: true,
        temporary_password_expires_at: new Date(Date.now() + expiresInMs),
    });
}

describe('native sign-in honours main account state', () => {
    const growthRoles = [];

    afterAll(async () => {
        await GrowthOsUserRole.destroy({ where: { id: growthRoles } });
        await cleanupFixtures();
    });

    test('a pending temporary password refuses the native session instead of issuing one without the change-password claim', async () => {
        const { fixture } = await issueChallenge('temp-password-plain');
        await fixture.user.update({ settings: {} }); // no 2FA on this account
        await withTemporaryPassword(fixture.user, 60 * 60 * 1000);

        const response = await nativeSignin(fixture.user.email);

        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
        expect(response.body.data?.accessToken).toBeUndefined();
        expect(await Session.count({ where: { user_id: fixture.user.id } })).toBe(0);
    });

    test('a pending temporary password on a 2FA account is refused before a challenge is handed out', async () => {
        const { fixture } = await issueChallenge('temp-password-2fa');
        await withTemporaryPassword(fixture.user, 60 * 60 * 1000);

        const response = await nativeSignin(fixture.user.email);

        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
        expect(response.body.data?.tempToken).toBeUndefined();
    });

    test('an expired temporary password is rejected exactly like the web path', async () => {
        const { fixture } = await issueChallenge('temp-password-expired');
        await withTemporaryPassword(fixture.user, -60 * 1000);

        const response = await nativeSignin(fixture.user.email);

        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('AUTH_TEMPORARY_PASSWORD_EXPIRED');
    });

    test('a temporary password set while the 2FA challenge is open refuses the verification', async () => {
        const { fixture, secret, tempToken } = await issueChallenge('temp-password-mid-2fa');
        await withTemporaryPassword(fixture.user, 60 * 60 * 1000);

        const response = await nativeVerify(tempToken, currentCode(secret));

        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
        expect(await Session.count({ where: { user_id: fixture.user.id } })).toBe(0);
    });

    test('a session invalidation between the password step and 2FA voids the challenge', async () => {
        const { fixture, secret, tempToken } = await issueChallenge('token-version-bound');
        await invalidateUserSessions(fixture.user.id);

        const response = await nativeVerify(tempToken, currentCode(secret));

        expect(response.status).toBe(401);
        expect(await Session.count({ where: { user_id: fixture.user.id } })).toBe(0);
    });

    test('Growth OS staff get no native session, on either sign-in step', async () => {
        const plain = await issueChallenge('growth-staff-plain');
        await plain.fixture.user.update({ settings: {} });
        const twoFactor = await issueChallenge('growth-staff-2fa');
        for (const { fixture } of [plain, twoFactor]) {
            const role = await GrowthOsUserRole.create({ user_id: fixture.user.id, role: 'MARKETER', is_active: true });
            growthRoles.push(role.id);
        }

        const signin = await nativeSignin(plain.fixture.user.email);
        expect(signin.status).toBe(403);

        // The role was granted after this challenge was issued; verification still refuses.
        const verify = await nativeVerify(twoFactor.tempToken, currentCode(twoFactor.secret));
        expect(verify.status).toBe(403);

        const userIds = [plain.fixture.user.id, twoFactor.fixture.user.id];
        expect(await Session.count({ where: { user_id: userIds } })).toBe(0);
        const reloaded = await User.findByPk(plain.fixture.user.id);
        expect(reloaded.refresh_token).toBeNull();
    });
});
