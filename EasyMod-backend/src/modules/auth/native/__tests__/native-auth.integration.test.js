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

// Native tokens may only reach the mobile read surface (auth.middleware
// NATIVE_READ_ROUTES), so "is this native session still accepted?" is probed
// on a route the app actually calls. Web tokens keep probing /api/auth/me.
const NATIVE_SESSION_PROBE = '/api/mobile/today';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const config = require('../../../../config/config');
const { hashPassword } = require('../../../../utils/password.util');
const { generateAccessToken } = require('../../../../utils/jwt.util');
const { User, Tenant, Shop, UserShop, Session, AuditLog } = require('../../../entities');
const providerRegistry = require('../../../channel-providers/provider.registry');
const nativeAuthService = require('../native-auth.service');
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

    test('native refresh, switch-shop, and authenticated sid requests fail closed after user_sessions.expires_at', async () => {
        const fixture = await makeUserWithShop('expired-session');
        track(fixture);
        const { user, shop } = fixture;

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        expect(signinRes.status).toBe(200);
        const { accessToken, refreshToken, sid } = signinRes.body.data;

        await Session.update(
            { expires_at: new Date(Date.now() - 1_000) },
            { where: { id: sid } },
        );

        const refreshRes = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: refreshToken });
        expect(refreshRes.status).toBe(401);

        const switchRes = await request(app)
            .post('/api/auth/native/switch-shop')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ shopId: shop.id });
        expect(switchRes.status).toBe(401);

        await expect(nativeAuthService.switchShop({
            user: { userId: user.id, sid, mfaVerified: false },
        }, shop.id)).rejects.toMatchObject({ status: 404 });

        const meRes = await request(app)
            .get(NATIVE_SESSION_PROBE)
            .set('Authorization', `Bearer ${accessToken}`);
        expect(meRes.status).toBe(401);
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
            .get(NATIVE_SESSION_PROBE)
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
            .get(NATIVE_SESSION_PROBE)
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

    test('native logout accepts refresh_token revocation when access has expired and ignores camelCase body names', async () => {
        const fixture = await makeUserWithShop('logout-refresh');
        track(fixture);
        const { user } = fixture;

        const signinRes = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        expect(signinRes.status).toBe(200);
        const { accessToken, refreshToken, sid } = signinRes.body.data;
        const accessClaims = jwt.decode(accessToken);
        delete accessClaims.iat;
        delete accessClaims.exp;
        const expiredAccessToken = jwt.sign(accessClaims, config.jwtAccessSecret, {
            algorithm: 'HS256',
            expiresIn: -1,
        });

        const camelCaseRes = await request(app)
            .post('/api/auth/native/logout')
            .set('Authorization', `Bearer ${expiredAccessToken}`)
            .send({ refreshToken });
        expect(camelCaseRes.status).toBe(401);
        expect((await Session.findByPk(sid)).is_active).toBe(true);

        const logoutRes = await request(app)
            .post('/api/auth/native/logout')
            .set('Authorization', `Bearer ${expiredAccessToken}`)
            .send({ refresh_token: refreshToken });
        expect(logoutRes.status).toBe(200);
        expect((await Session.findByPk(sid)).is_active).toBe(false);

        const refreshAfterLogout = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: refreshToken });
        expect(refreshAfterLogout.status).toBe(401);
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
            .get(NATIVE_SESSION_PROBE)
            .set('Authorization', `Bearer ${refreshA.body.data.accessToken}`);
        const meB = await request(app)
            .get(NATIVE_SESSION_PROBE)
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

        // The session now belongs to shop2, so the pre-switch shop1 token is
        // refused immediately rather than until its 15-minute expiry.
        const staleShopToken = await request(app)
            .get(NATIVE_SESSION_PROBE)
            .set('Authorization', `Bearer ${accessToken}`);
        expect(staleShopToken.status).toBe(401);

        const switchForbidden = await request(app)
            .post('/api/auth/native/switch-shop')
            .set('Authorization', `Bearer ${switchOk.body.data.accessToken}`)
            .send({ shopId: shop3.id });
        expect(switchForbidden.status).toBe(403);
    });

    test('native sid tokens cannot invoke web conversation mutations or trigger a provider send, while web tokens remain eligible for the route', async () => {
        const fixture = await makeUserWithShop('readonly-route');
        track(fixture);
        const { user, shop } = fixture;

        const nativeSignin = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: user.email, password: PASSWORD });
        expect(nativeSignin.status).toBe(200);

        const freshUser = await User.findByPk(user.id);
        const webAccessToken = generateAccessToken({
            userId: freshUser.id,
            email: freshUser.email,
            shopId: shop.id,
            tokenVersion: freshUser.token_version,
            mfaVerified: false,
        });
        const provider = providerRegistry.getProvider('facebook');
        const sendSpy = jest.spyOn(provider, 'sendMessage');

        try {
            const nativeMutation = await request(app)
                .post(`/api/conversation/${uuidv4()}/messages`)
                .set('Authorization', `Bearer ${nativeSignin.body.data.accessToken}`)
                .send({ content: 'native pilot mutation', sender: 'agent' });
            expect(nativeMutation.status).toBe(403);
            expect(nativeMutation.body.code).toBe('NATIVE_READ_ONLY');
            expect(sendSpy).not.toHaveBeenCalled();

            // A sid-less web token must still reach the existing route policy;
            // this malformed body is rejected by its normal route validator,
            // not by the native-only read-only guard.
            const webMutation = await request(app)
                .post(`/api/conversation/${uuidv4()}/messages`)
                .set('Authorization', `Bearer ${webAccessToken}`)
                .send({});
            expect(webMutation.status).toBe(400);
            expect(webMutation.body.code).not.toBe('NATIVE_READ_ONLY');
        } finally {
            sendSpy.mockRestore();
        }
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
            .get(NATIVE_SESSION_PROBE)
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

    test('native 2fa verification rejects the sixth invalid attempt from one IP with 429', async () => {
        const previousTrustProxy = app.get('trust proxy');
        app.set('trust proxy', 1);
        try {
            const responses = [];
            for (let index = 0; index < 6; index += 1) {
                responses.push(
                    await request(app)
                        .post('/api/auth/native/2fa/verify')
                        .set('X-Forwarded-For', '203.0.113.42')
                        .send({
                            tempToken: `test-only-invalid-temp-token-${index}`,
                            token: '000000',
                        }),
                );
            }

            expect(responses.slice(0, 5).map((response) => response.status)).toEqual([
                401,
                401,
                401,
                401,
                401,
            ]);
            expect(responses[5].status).toBe(429);
            expect(responses[5].body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        } finally {
            app.set('trust proxy', previousTrustProxy);
        }
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

    /**
     * ADR M-003 drift prevention (Phase 2, mobile/p2-contract).
     *
     * Phase 1 shipped a mobile client and this backend module that were never tested against each
     * other: this suite asserted against `res.body.data.*` (internally consistent with itself) and
     * the mobile client's tests used a fake `Transport` returning whatever shape the client's OWN
     * zod schema expected. Nothing crossed the real boundary, so three real shape drifts (envelope
     * wrapping, refresh_token field naming, shopId location) shipped unnoticed.
     *
     * This test captures the REAL response bodies this Express app actually returns — against a
     * real disposable Postgres/Redis, not a mock — for signin, refresh, and 2fa/verify, and writes
     * them to a committed JSON fixture. `EasyMod-mobile/src/auth/native-auth-contract.test.ts` loads
     * that exact file and parses it with the production zod schemas from `auth-client.ts`. If either
     * side's shape drifts in the future, one of these two suites fails immediately and mechanically
     * — no more silent divergence.
     *
     * `accessToken`/`refreshToken`/`tempToken` are overwritten with fixed, low-entropy placeholder
     * strings before the fixture is written (see `withPlaceholderTokens` below) — everything else
     * (shopId, user.*, sid, success, message) is the real captured value. The real tokens this test
     * run actually produces are genuine signed JWTs, needed internally so the signin -> refresh
     * chain above can complete against the real session-rotation logic, but nothing downstream ever
     * needs them to parse as JWTs: `auth-client.ts`'s schemas assert only `z.string()` on these
     * fields, never JWT structure. Committing the real bytes bought no drift-detection value while
     * permanently tripping secret scanners on every commit that touches this file (gitleaks' `jwt`
     * and `generic-api-key` rules match real signed-JWT-shaped strings by pattern, not by whether
     * they are exploitable) — so this test only ever writes the placeholders to disk.
     */
    function withPlaceholderTokens(responseBody, replacements) {
        return { ...responseBody, data: { ...responseBody.data, ...replacements } };
    }
    test('drift-prevention fixture (ADR M-003): captures real signin/refresh/2fa-verify response bodies for the mobile contract test', async () => {
        const plain = await makeUserWithShop('fixture-plain');
        track(plain);

        const plainSignin = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: plain.user.email, password: PASSWORD });
        expect(plainSignin.status).toBe(200);
        expect(typeof plainSignin.body.data.accessToken).toBe('string');

        const plainRefresh = await request(app)
            .post('/api/auth/native/refresh')
            .send({ refresh_token: plainSignin.body.data.refreshToken });
        expect(plainRefresh.status).toBe(200);
        expect(plainRefresh.body.data.shopId).toBe(plain.shop.id);
        expect(plainRefresh.body.data.user.id).toBe(plain.user.id);

        const twofa = await makeUserWithShop('fixture-2fa');
        track(twofa);
        const step = 30;
        const secretResult = await totpService.generateTotpSecret(twofa.user.id);
        const setupCode = totpService.hotp(secretResult.secret, Math.floor(Date.now() / 1000 / step));
        await totpService.enableTotp(twofa.user.id, setupCode);

        const twofaSignin = await request(app)
            .post('/api/auth/native/signin')
            .send({ email: twofa.user.email, password: PASSWORD });
        expect(twofaSignin.status).toBe(200);
        expect(twofaSignin.body.data.requires2fa).toBe(true);

        const verifyCode = totpService.hotp(secretResult.secret, Math.floor(Date.now() / 1000 / step));
        const twofaVerify = await request(app)
            .post('/api/auth/native/2fa/verify')
            .send({ tempToken: twofaSignin.body.data.tempToken, token: verifyCode });
        expect(twofaVerify.status).toBe(200);
        expect(typeof twofaVerify.body.data.accessToken).toBe('string');

        const fixturePayload = {
            _generatedBy:
                'EasyMod-backend/src/modules/auth/native/__tests__/native-auth.integration.test.js (re-run this suite to regenerate; do not hand-edit)',
            _purpose:
                "ADR M-003 drift prevention. EasyMod-mobile/src/auth/native-auth-contract.test.ts loads this file and parses it with the PRODUCTION zod schemas from auth-client.ts. If either side's response shape drifts, one of the two suites fails immediately.",
            _redaction:
                'accessToken/refreshToken/tempToken below are fixed, low-entropy placeholder strings, never the ' +
                'real signed JWTs this test run actually produced — see withPlaceholderTokens above for why. ' +
                'Every other field (shopId, user.*, sid, success, message) is the real value this Express app ' +
                'returned against a disposable, throwaway Postgres/Redis stack created for this test run.',
            capturedAt: new Date().toISOString(),
            signin: withPlaceholderTokens(plainSignin.body, {
                accessToken: 'test-fixture-signin-access-token-do-not-use',
                refreshToken: 'test-fixture-signin-refresh-token-do-not-use',
            }),
            refresh: withPlaceholderTokens(plainRefresh.body, {
                accessToken: 'test-fixture-refresh-access-token-do-not-use',
                refreshToken: 'test-fixture-refresh-refresh-token-do-not-use',
            }),
            signin2faRequired: withPlaceholderTokens(twofaSignin.body, {
                tempToken: 'test-fixture-2fa-temp-token-do-not-use',
            }),
            twoFactorVerify: withPlaceholderTokens(twofaVerify.body, {
                accessToken: 'test-fixture-2fa-verify-access-token-do-not-use',
                refreshToken: 'test-fixture-2fa-verify-refresh-token-do-not-use',
            }),
        };

        const fixtureDir = path.join(__dirname, '__fixtures__');
        fs.mkdirSync(fixtureDir, { recursive: true });
        fs.writeFileSync(
            path.join(fixtureDir, 'native-auth-responses.json'),
            `${JSON.stringify(fixturePayload, null, 2)}\n`,
            'utf8',
        );
    });
});
