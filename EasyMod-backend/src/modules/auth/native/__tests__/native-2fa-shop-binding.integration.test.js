'use strict';

/**
 * Audit P1-8: a native 2FA verification must bind the new session to a shop the
 * user is an active member of *at verification time*, not to whatever
 * last_logged_shop_id held when the five-minute challenge was issued.
 * Kept in its own file so the per-IP native 2FA limiter (5 attempts) is fresh.
 */

const request = require('supertest');
const {
    app,
    currentCode,
    issueChallenge,
    addShopMembership,
    cleanupFixtures,
} = require('./native-2fa.integration.helpers');
const { UserShop, Session } = require('../../../entities');

describe('native 2FA session shop binding', () => {
    afterAll(async () => {
        await cleanupFixtures();
    });

    test('does not issue a session for a last-used shop whose membership was deactivated', async () => {
        const challenge = await issueChallenge('stale-last-shop');
        const staleShopId = challenge.fixture.shop.id;
        const activeShop = await addShopMembership(challenge.fixture, 'still-active');
        await UserShop.update(
            { is_active: false },
            { where: { user_id: challenge.fixture.user.id, shop_id: staleShopId } },
        );

        const response = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: challenge.tempToken, token: currentCode(challenge.secret) });

        expect(response.status).toBe(200);
        expect(response.body.data.shopId).toBe(activeShop.id);
        const session = await Session.findByPk(response.body.data.sid);
        expect(session.shop_id).toBe(activeShop.id);
    });

    test('refuses to issue any session once the user has no active shop membership', async () => {
        const challenge = await issueChallenge('no-active-shop');
        await UserShop.update(
            { is_active: false },
            { where: { user_id: challenge.fixture.user.id } },
        );

        const response = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: challenge.tempToken, token: currentCode(challenge.secret) });

        expect(response.status).toBe(401);
        expect(response.body.data?.accessToken).toBeUndefined();
        const sessions = await Session.count({ where: { user_id: challenge.fixture.user.id } });
        expect(sessions).toBe(0);
    });
});
