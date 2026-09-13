'use strict';

/**
 * ADR M-004 native auth, against REAL PostgreSQL and Redis (see
 * tests/integration/env.js and docker-compose.test.yml). Exercises the
 * actual Express app, actual session table, actual JWT secrets — not mocks.
 *
 * MOBILE_API_ENABLED is turned on for this file only, before `app` (and
 * therefore config.js) is first required in this file's own module registry
 * — see native-auth-disabled.integration.test.js for the flag-off / 404
 * companion, which needs the opposite value and therefore lives in its own
 * file.
 */
process.env.MOBILE_API_ENABLED = 'true';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const config = require('../../../../config/config');
const { hashPassword } = require('../../../../utils/password.util');
const { generateAccessToken } = require('../../../../utils/jwt.util');
const { User, Tenant, Shop, UserShop, Session, AuditLog } = require('../../../entities');
const totpService = require('../../totp.service');

const app = require('../../../../app');

const PASSWORD = 'Sup3r-Secret!234';

/**
 * The global express-session middleware (session.middleware.js) stamps a
 * `commerce_ai.sid` cookie on EVERY response app-wide — pre-existing,
 * unconditional (saveUninitialized: true), and explicitly out of scope for
 * this ADR to change (native auth never touches session.middleware.js). A
 * real native client with no cookie jar simply never persists or resends it.
 * What ADR M-004 actually guarantees is that native routes never call
 * setAuthCookies — i.e. no access_token/refresh_token cookie — so that is
 * what this file asserts, rather than "zero Set-Cookie headers at all".
 */
const hasAuthCookie = (res) =>
    (res.headers['set-cookie'] || []).some(
        (c) => c.startsWith('access_token=') || c.startsWith('refresh_token='),
    );

async function makeUserWithShop(label) {
    const suffix = uuidv4();
    const tenant = await Tenant.create({ name: `Native Auth ${label} ${suffix}` });
    const shop = await Shop.create({
        unique_code: `NA-${suffix}`.slice(0, 20),
        tenant_id: tenant.id,
        shop_name: `Native Auth Shop ${label}`,
        name: `Native Auth Shop ${label}`,
    });
    const user = await User.create({
        email: `native-${label}-${suffix}@example.test`,
        password: await hashPassword(PASSWORD),
        full_name: `Native Auth ${label}`,
        settings: {},
    });
    await UserShop.create({ user_id: user.id, shop_id: shop.id, role: 'owner', is_active: true });
    await user.update({ last_logged_shop_id: shop.id });
    return { user, shop, tenant };
}

describe('native auth (ADR M-004) on PostgreSQL and Redis', () => {
    const userIds = [];
    const shopIds = [];
    const tenantIds = [];

    const track = ({ user, shop, tenant }) => {
        userIds.push(user.id);
        shopIds.push(shop.id);
        tenantIds.push(tenant.id);
    };

    afterAll(async () => {
        await Session.destroy({ where: { user_id: { [Op.in]: userIds } } });
        await AuditLog.destroy({ where: { user_id: { [Op.in]: userIds } } });
        await UserShop.destroy({ where: { user_id: { [Op.in]: userIds } } });
        await User.destroy({ where: { id: { [Op.in]: userIds } } });
        await Shop.destroy({ where: { id: { [Op.in]: shopIds } } });
        await Tenant.destroy({ where: { id: { [Op.in]: tenantIds } } });
        // Do not close shared Sequelize/Redis clients — other real-stack
        // suites may still run in this worker process.
    });

    test('native signin issues body tokens (15-minute access token with sid) and sets no cookies', async () => {
        const fixture = await makeUserWithShop('signin');
        track(fixture);
        const { user, shop } = fixture;

        const res = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });

        expect(res.status).toBe(200);
        expect(hasAuthCookie(res)).toBe(false);
        expect(typeof res.body.data.accessToken).toBe('string');
        expect(typeof res.body.data.refreshToken).toBe('string');
        expect(res.body.data.sid).toBeTruthy();

        const decoded = jwt.verify(res.body.data.accessToken, config.jwtAccessSecret);
        expect(decoded.sid).toBe(res.body.data.sid);
        expect(decoded.shopId).toBe(shop.id);
        expect(decoded.exp - decoded.iat).toBe(15 * 60);

        const session = await Session.findByPk(res.body.data.sid);
        expect(session).not.toBeNull();
        expect(session.is_active).toBe(true);
        expect(session.refresh_token_generation).toBe(1);
        expect(session.refresh_token_hash).toBeTruthy();
        // The session token column is a pre-existing artefact of createSession;
        // it must never leak into the HTTP response either.
        expect(res.body.data.session_token).toBeUndefined();
    });

    test('native refresh rotates the token; reusing an old (already-rotated) refresh token revokes the whole session family and is audit-logged', async () => {
        const fixture = await makeUserWithShop('rotate');
        track(fixture);
        const { user } = fixture;

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        const { refreshToken: token1, sid } = signinRes.body.data;

        const refreshRes1 = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: token1 });
        expect(refreshRes1.status).toBe(200);
        const token2 = refreshRes1.body.data.refreshToken;
        expect(token2).not.toBe(token1);
        expect(hasAuthCookie(refreshRes1)).toBe(false);

        // Reuse the already-rotated token1 — this is the compromise signal.
        const reuseRes = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: token1 });
        expect(reuseRes.status).toBe(401);

        const session = await Session.findByPk(sid);
        expect(session.is_active).toBe(false);
        expect(session.metadata?.deactivated_reason).toBe('refresh_token_reuse_detected');

        const auditRow = await AuditLog.findOne({
            where: { user_id: user.id, action: 'NATIVE_REFRESH_TOKEN_REUSE_DETECTED' },
        });
        expect(auditRow).not.toBeNull();
        expect(auditRow.metadata?.session_id).toBe(sid);

        // The whole family is revoked — even the legitimately-rotated token2
        // (which was never itself reused) is now rejected too.
        const afterRevokeRes = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: token2 });
        expect(afterRevokeRes.status).toBe(401);
    });

    test('two concurrent refreshes of the same not-yet-rotated token fail closed on the loser, without revoking the session or logging reuse-detected', async () => {
        const fixture = await makeUserWithShop('concurrent-refresh');
        track(fixture);
        const { user } = fixture;

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        const { refreshToken: token1, sid } = signinRes.body.data;

        // Fire both requests concurrently with the identical, still-current
        // token — simulating a client-side retry-after-timeout race rather
        // than an attacker replaying an already-rotated link.
        const [resA, resB] = await Promise.all([
            request(app).post('/api/auth/native/refresh').send({ refresh_token: token1 }),
            request(app).post('/api/auth/native/refresh').send({ refresh_token: token1 }),
        ]);
        const statuses = [resA.status, resB.status].sort();

        // Exactly one wins (200, with a real new token pair) and one loses
        // the compare-and-swap (409) — never both succeeding (which would
        // silently corrupt the stored hash) and never a 401
        // reuse-detected/session-revoked outcome for a benign race.
        expect(statuses).toEqual([200, 409]);

        const winner = resA.status === 200 ? resA : resB;
        expect(winner.body.data.refreshToken).not.toBe(token1);

        const session = await Session.findByPk(sid);
        expect(session.is_active).toBe(true);
        expect(session.metadata?.deactivated_reason).toBeUndefined();

        const auditRow = await AuditLog.findOne({
            where: { user_id: user.id, action: 'NATIVE_REFRESH_TOKEN_REUSE_DETECTED' },
        });
        expect(auditRow).toBeNull();

        // The winning token pair is fully usable afterward.
        const followUp = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: winner.body.data.refreshToken });
        expect(followUp.status).toBe(200);
    });

    test('sid revocation on native logout rejects that access token; an existing web token with no sid is completely unaffected', async () => {
        const fixture = await makeUserWithShop('sid-revoke');
        track(fixture);
        const { user, shop } = fixture;

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        const nativeAccessToken = signinRes.body.data.accessToken;

        const freshUser = await User.findByPk(user.id);
        const webAccessToken = generateAccessToken({
            userId: freshUser.id,
            email: freshUser.email,
            shopId: shop.id,
            tokenVersion: freshUser.token_version,
            mfaVerified: false,
        });

        const nativeBefore = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${nativeAccessToken}`);
        expect(nativeBefore.status).toBe(200);

        const webBefore = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${webAccessToken}`);
        expect(webBefore.status).toBe(200);

        const logoutRes = await request(app)
            .post('/api/auth/native/logout')
            .set('Authorization', `Bearer ${nativeAccessToken}`);
        expect(logoutRes.status).toBe(200);

        const nativeAfter = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${nativeAccessToken}`);
        expect(nativeAfter.status).toBe(401);

        // REGRESSION: the sid-less web token must be completely unaffected —
        // it never carries a sid claim, so it never consults the sessions
        // table at all.
        const webAfter = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${webAccessToken}`);
        expect(webAfter.status).toBe(200);
    });

    test('concurrent multi-device native logins for the same user do not invalidate each other', async () => {
        const fixture = await makeUserWithShop('multi-device');
        track(fixture);
        const { user } = fixture;

        const deviceA = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        const deviceB = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });

        expect(deviceA.status).toBe(200);
        expect(deviceB.status).toBe(200);
        expect(deviceA.body.data.sid).not.toBe(deviceB.body.data.sid);

        // Refreshing device A must not disturb device B's independent chain —
        // each native session owns its own row/lineage, unlike the single
        // shared web refresh_token slot.
        const refreshA = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: deviceA.body.data.refreshToken });
        expect(refreshA.status).toBe(200);

        const refreshB = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: deviceB.body.data.refreshToken });
        expect(refreshB.status).toBe(200);

        const meA = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${refreshA.body.data.accessToken}`);
        const meB = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${refreshB.body.data.accessToken}`);
        expect(meA.status).toBe(200);
        expect(meB.status).toBe(200);
    });

    test('native signin never touches the single web refresh_token slot (fixes the pre-existing shared-slot bug for native)', async () => {
        const fixture = await makeUserWithShop('web-slot');
        track(fixture);
        const { user } = fixture;

        const webSignin = await request(app)
            .post('/api/auth/signin')
            .send({ email: user.email, password: PASSWORD });
        expect(webSignin.status).toBe(200);

        const afterWebLogin = await User.findByPk(user.id);
        const webSlotHash = afterWebLogin.refresh_token;
        expect(webSlotHash).toBeTruthy();

        const nativeSignin = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        expect(nativeSignin.status).toBe(200);

        const afterNativeLogin = await User.findByPk(user.id);
        expect(afterNativeLogin.refresh_token).toBe(webSlotHash);
    });

    test('switch-shop issues a new access token for an actively-membered shop and rejects one the user cannot access', async () => {
        const fixture = await makeUserWithShop('switch');
        track(fixture);
        const { user, shop: shop1, tenant } = fixture;

        const shop2 = await Shop.create({
            unique_code: `NA2-${uuidv4()}`.slice(0, 20),
            tenant_id: tenant.id,
            shop_name: 'Second Shop',
            name: 'Second Shop',
        });
        shopIds.push(shop2.id);
        await UserShop.create({ user_id: user.id, shop_id: shop2.id, role: 'staff', is_active: true });

        const shop3 = await Shop.create({
            unique_code: `NA3-${uuidv4()}`.slice(0, 20),
            tenant_id: tenant.id,
            shop_name: 'No Access Shop',
            name: 'No Access Shop',
        });
        shopIds.push(shop3.id);
        // Deliberately no UserShop row for shop3 — not a member.

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        const { accessToken, sid } = signinRes.body.data;
        expect(signinRes.body.data.shopId).toBe(shop1.id);

        const switchOk = await request(app)
            .post('/api/auth/native/switch-shop')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ shopId: shop2.id });
        expect(switchOk.status).toBe(200);
        const decoded = jwt.verify(switchOk.body.data.accessToken, config.jwtAccessSecret);
        expect(decoded.shopId).toBe(shop2.id);
        expect(decoded.sid).toBe(sid);

        const switchForbidden = await request(app)
            .post('/api/auth/native/switch-shop')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ shopId: shop3.id });
        expect(switchForbidden.status).toBe(403);
    });

    test('lists and revokes this user\'s own device sessions', async () => {
        const fixture = await makeUserWithShop('sessions-list');
        track(fixture);
        const { user } = fixture;

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        const { accessToken, sid } = signinRes.body.data;

        const listRes = await request(app)
            .get('/api/auth/native/sessions')
            .set('Authorization', `Bearer ${accessToken}`);
        expect(listRes.status).toBe(200);
        expect(listRes.body.data.sessions.some((s) => s.id === sid && s.isCurrent)).toBe(true);

        const revokeRes = await request(app)
            .delete(`/api/auth/native/sessions/${sid}`)
            .set('Authorization', `Bearer ${accessToken}`);
        expect(revokeRes.status).toBe(200);

        const afterRevoke = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${accessToken}`);
        expect(afterRevoke.status).toBe(401);
    });

    test('2fa/verify issues body tokens via the same tempToken flow as web; native refresh with X-EM-Client attaches metadata.source MOBILE to the audit row (ADR M-005)', async () => {
        const fixture = await makeUserWithShop('twofa');
        track(fixture);
        const { user } = fixture;

        const secretResult = await totpService.generateTotpSecret(user.id);
        const step = 30;
        const setupCode = totpService.hotp(secretResult.secret, Math.floor(Date.now() / 1000 / step));
        await totpService.enableTotp(user.id, setupCode);

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        expect(signinRes.status).toBe(200);
        expect(signinRes.body.data.requires2fa).toBe(true);
        expect(signinRes.body.data.accessToken).toBeUndefined();
        const { tempToken } = signinRes.body.data;

        const verifyCode = totpService.hotp(secretResult.secret, Math.floor(Date.now() / 1000 / step));
        const verifyRes = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken, token: verifyCode });

        expect(verifyRes.status).toBe(200);
        expect(typeof verifyRes.body.data.accessToken).toBe('string');
        expect(hasAuthCookie(verifyRes)).toBe(false);

        const refreshRes = await request(app)
            .post('/api/auth/native/refresh')
            .set('X-EM-Client', 'android/1.0.0')
            .send({ refresh_token: verifyRes.body.data.refreshToken });
        expect(refreshRes.status).toBe(200);

        const auditRow = await AuditLog.findOne({
            where: { user_id: user.id, action: 'NATIVE_TOKEN_REFRESH' },
            order: [['created_at', 'DESC']],
        });
        expect(auditRow).not.toBeNull();
        expect(auditRow.metadata?.source).toBe('MOBILE');
    });

    test('a refresh audit row written WITHOUT X-EM-Client carries no metadata.source (unchanged shape)', async () => {
        const fixture = await makeUserWithShop('no-header');
        track(fixture);
        const { user } = fixture;

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });

        const refreshRes = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: signinRes.body.data.refreshToken });
        expect(refreshRes.status).toBe(200);

        const auditRow = await AuditLog.findOne({
            where: { user_id: user.id, action: 'NATIVE_TOKEN_REFRESH' },
            order: [['created_at', 'DESC']],
        });
        expect(auditRow).not.toBeNull();
        expect(auditRow.metadata?.source).toBeUndefined();
    });
});
