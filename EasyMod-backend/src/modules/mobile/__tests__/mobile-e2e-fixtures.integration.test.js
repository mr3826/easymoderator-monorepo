'use strict';

/**
 * Disposable mobile E2E controls against real PostgreSQL/Redis: every action
 * acts only on the deterministic seed rows, never on an unrelated merchant.
 * The fixture env must be set before `app` (and so mobile.routes.js) loads.
 */

const CONTROL_TOKEN = 'mobile-e2e-integration-control-token-0123456789';
process.env.MOBILE_API_ENABLED = 'true';
process.env.MOBILE_E2E_FIXTURES_ENABLED = 'true';
process.env.MOBILE_E2E_FIXTURES_TOKEN = CONTROL_TOKEN;

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const app = require('../../../app');
const { Tenant, Shop, Order, Product, Session, User } = require('../../entities');
const seedModule = require('../../../../scripts/seed-mobile-dev');
const totpService = require('../../auth/totp.service');
const { getRedisClient } = require('../../../utils/redis-client');

const control = (body, token = CONTROL_TOKEN) => request(app)
    .post('/api/mobile/e2e/control')
    .set('X-Mobile-E2E-Control', token)
    .send(body);

const SEED_PASSWORD = process.env.MOBILE_DEV_SEED_PASSWORD || 'MobileDev123!';

async function nativeSignin(email) {
    const res = await request(app)
        .post('/api/auth/native/signin')
        .send({ email, password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data;
}

describe('mobile E2E fixture controls (disposable stack)', () => {
    let unrelated;

    beforeAll(async () => {
        const suffix = uuidv4();
        const tenant = await Tenant.create({ name: `Unrelated tenant ${suffix}` });
        const shop = await Shop.create({
            unique_code: `UNREL-${suffix}`.slice(0, 20),
            tenant_id: tenant.id,
            shop_name: 'Unrelated merchant',
            name: 'Unrelated merchant',
        });
        const product = await Product.create({
            shop_id: shop.id,
            name: 'Unrelated product',
            price: 100,
            quantity: 1,
            low_stock_threshold: 5,
            track_quantity: true,
            is_active: true,
        });
        const user = await User.create({
            email: `unrelated-${suffix}@example.test`,
            password: 'not-used-in-this-test',
            full_name: 'Unrelated user',
        });
        const session = await Session.create({
            user_id: user.id,
            shop_id: shop.id,
            session_token: `unrelated-session-${suffix}`,
            is_active: true,
            expires_at: new Date(Date.now() + 60 * 60 * 1000),
        });
        unrelated = { tenant, shop, product, user, session };

        const reset = await control({ action: 'reset' });
        expect(reset.status).toBe(200);
    });

    afterAll(async () => {
        await seedModule.remove();
        await Session.destroy({ where: { id: unrelated.session.id } });
        await Product.destroy({ where: { id: unrelated.product.id }, force: true });
        await User.destroy({ where: { id: unrelated.user.id } });
        await Shop.destroy({ where: { id: unrelated.shop.id } });
        await Tenant.destroy({ where: { id: unrelated.tenant.id } });
    });

    test('reports its capabilities only to the control-token holder', async () => {
        const ok = await control({ action: 'capabilities' });
        expect(ok.status).toBe(200);
        expect(ok.body.data).toEqual(expect.objectContaining({
            emptyHome: true,
            homeApiError: true,
            sessionExpiry: true,
            twoFactor: true,
            twoFactorExpiry: true,
            secondShop: true,
        }));

        const wrong = await control({ action: 'capabilities' }, 'wrong-token-that-is-long-enough-0123456789');
        const missing = await request(app).post('/api/mobile/e2e/control').send({ action: 'capabilities' });
        expect(wrong.status).toBe(404);
        expect(missing.status).toBe(404);
    });

    test('seeds two isolated shops whose owners each see only their own Home', async () => {
        const shopA = await nativeSignin(seedModule.OWNER_EMAIL);
        const shopB = await nativeSignin(seedModule.SECOND_SHOP.ownerEmail);
        expect(shopA.shopId).not.toBe(shopB.shopId);

        const homeB = await request(app)
            .get('/api/mobile/attention')
            .set('Authorization', `Bearer ${shopB.accessToken}`);
        expect(homeB.status).toBe(200);
        const entityIds = homeB.body.data.items.map((item) => item.entity.id);
        expect(entityIds).toEqual([seedModule.stableId(seedModule.SECOND_SHOP.productScope)]);

        const shopAOrderId = seedModule.stableId('order:draft-risky');
        const crossShop = await request(app)
            .get(`/api/order/${shopAOrderId}`)
            .set('Authorization', `Bearer ${shopB.accessToken}`);
        expect(crossShop.status).toBe(404);
    });

    test('empty-home empties only the seed shop', async () => {
        const res = await control({ action: 'empty-home' });
        expect(res.status).toBe(200);

        const { accessToken } = await nativeSignin(seedModule.OWNER_EMAIL);
        const home = await request(app).get('/api/mobile/attention').set('Authorization', `Bearer ${accessToken}`);
        expect(home.body.data.items).toEqual([]);

        await unrelated.product.reload();
        expect(unrelated.product.is_active).toBe(true);
        const shopBProduct = await Product.findByPk(seedModule.stableId(seedModule.SECOND_SHOP.productScope));
        expect(shopBProduct.is_active).toBe(true);

        await control({ action: 'reset' });
    });

    test('set-api-error fails the Home endpoint a bounded number of times, then recovers', async () => {
        const { accessToken } = await nativeSignin(seedModule.OWNER_EMAIL);
        await control({ action: 'set-api-error', endpoint: 'today', failures: 2 });

        const statuses = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const res = await request(app).get('/api/mobile/today').set('Authorization', `Bearer ${accessToken}`);
            statuses.push(res.status);
        }
        expect(statuses).toEqual([503, 503, 200]);
    });

    test('expire-sessions expires only the seed owner sessions', async () => {
        const { accessToken } = await nativeSignin(seedModule.OWNER_EMAIL);
        const res = await control({ action: 'expire-sessions' });
        expect(res.status).toBe(200);
        expect(res.body.data.expiredSessionCount).toBeGreaterThan(0);

        const denied = await request(app).get('/api/mobile/today').set('Authorization', `Bearer ${accessToken}`);
        expect(denied.status).toBe(401);

        await unrelated.session.reload();
        expect(unrelated.session.is_active).toBe(true);
        expect(new Date(unrelated.session.expires_at).getTime()).toBeGreaterThan(Date.now());
        await control({ action: 'reset' });
    });

    test('2FA controls: challenge expiry touches only the seed owner, codes verify', async () => {
        const prepared = await control({ action: 'prepare-2fa' });
        expect(prepared.status).toBe(200);

        const unrelatedChallenge = `unrelated-challenge-${uuidv4()}`;
        await totpService.saveTempToken(unrelated.user.id, unrelatedChallenge);

        const signin = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: seedModule.OWNER_EMAIL, password: SEED_PASSWORD });
        expect(signin.body.data.requires2fa).toBe(true);

        const expired = await control({ action: 'expire-2fa-challenge' });
        expect(expired.body.data.expiredChallengeCount).toBe(1);
        expect(await getRedisClient().get(`totp_temp:${unrelatedChallenge}`)).toBe(unrelated.user.id);

        const codes = (await control({ action: 'current-2fa-code' })).body.data;
        expect(codes.code).toMatch(/^\d{6}$/);
        expect(codes.invalidCode).toMatch(/^\d{6}$/);
        expect(codes.invalidCode).not.toBe(codes.code);

        const afterExpiry = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: signin.body.data.tempToken, token: codes.code });
        expect(afterExpiry.status).toBe(401);

        await control({ action: 'reset' });
        const owner = await User.findByPk(seedModule.stableId('user:owner'));
        expect(owner.settings?.totp_enabled).toBeFalsy();
    });
});
