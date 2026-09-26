#!/usr/bin/env node
'use strict';

/**
 * Production proof for the mobile API (docs/deployment/MOBILE_API_ACTIVATION_RUNBOOK.md).
 *
 * Run by .github/workflows/mobile-production-proof.yml against the live API with
 * the designated production test identities. It proves the Wave 2.5 contract end
 * to end — sign-in, Home data, deep-link entity reads, shop isolation, the
 * read-only native-token boundary, session rotation/reuse detection, remote
 * revocation, logout and re-login — plus web/Growth health, or, with
 * EXPECT_MOBILE_API=disabled, the fail-closed rollback state.
 *
 * It never prints a credential, a token or a merchant record: output is check
 * names, HTTP statuses, counts and entity kinds. Every native session it opens
 * is revoked before it exits, and it never holds more than two at once (the
 * backend keeps three per user and evicts the oldest).
 *
 * Environment:
 *   EXPECTED_SHA            full commit the API must report (required)
 *   EXPECT_MOBILE_API       enabled | disabled (required)
 *   API_BASE_URL            default https://api.easymod.tech
 *   APP_URL, GROWTH_URL     default https://app.easymod.tech, https://growth.easymod.tech
 *   MERCHANT_EMAIL/PASSWORD designated test merchant (required when enabled)
 *   ADMIN_EMAIL/PASSWORD    optional SUPER_ADMIN review account (best effort)
 *   PROOF_CLIENT            X-EM-Client value, so the traffic is findable in logs
 *   REPORT_PATH             JSON report destination (optional)
 *   GITHUB_OUTPUT           receives order_id / conversation_id for device proof
 */

const crypto = require('crypto');
const fs = require('fs');

const env = process.env;
const API = new URL(env.API_BASE_URL || 'https://api.easymod.tech');
const APP_URL = env.APP_URL || 'https://app.easymod.tech';
const GROWTH_URL = env.GROWTH_URL || 'https://growth.easymod.tech';
const CLIENT = env.PROOF_CLIENT || 'android/production-proof';
const MODE = env.EXPECT_MOBILE_API;
const SIGNAL_TYPES = new Set([
    'COURIER_FAILED', 'COURIER_INDETERMINATE', 'COURIER_SETUP_REQUIRED',
    'INBOX_NEEDS_REPLY', 'DRAFT_ORDER', 'RTO_VERIFY', 'LOW_STOCK',
]);

const results = [];
const outputs = {};
const openSessions = new Map();

function record(name, pass, detail = '') {
    results.push({ name, result: pass === null ? 'SKIP' : pass ? 'PASS' : 'FAIL', detail });
}

const randomUuid = () => crypto.randomUUID();

async function call(method, path, { token, body, headers = {}, base = API } = {}) {
    const requestHeaders = { Accept: 'application/json', 'X-EM-Client': CLIENT, ...headers };
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    const started = Date.now();
    const response = await fetch(new URL(path, base), {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch (_error) {
        json = null;
    }
    return { status: response.status, json, headers: response.headers, ms: Date.now() - started };
}

/** Status plus the server's error code, never the message body. */
const describe = (res) => `HTTP ${res.status}${res.json?.code ? ` ${res.json.code}` : ''} ${res.ms}ms`;

async function expectStatus(name, request, status, code) {
    const res = await request();
    const pass = res.status === status && (code === undefined || res.json?.code === code);
    record(name, pass, describe(res));
    return res;
}

function isIsoDate(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

const nonNegativeInt = (value) => Number.isInteger(value) && value >= 0;

/** Mirrors EasyMod-mobile/src/api/mobile/schemas.ts (todayResponseSchema). */
function todayShapeProblems(data) {
    const problems = [];
    if (!data || typeof data !== 'object') return ['no data'];
    if (typeof data.date !== 'string') problems.push('date');
    for (const key of ['order_count', 'delivered_count']) if (!nonNegativeInt(data[key])) problems.push(key);
    if (typeof data.revenue !== 'number') problems.push('revenue');
    const pending = data.pending_actions || {};
    for (const key of ['draft_orders', 'needs_reply', 'courier_problems', 'rto_verify', 'low_stock']) {
        if (!nonNegativeInt(pending[key])) problems.push(`pending_actions.${key}`);
    }
    if (!['Asia/Dhaka', 'UTC'].includes(data.timezone_used)) problems.push('timezone_used');
    if (typeof data.conversation_scan_truncated !== 'boolean') problems.push('conversation_scan_truncated');
    if (!isIsoDate(data.generated_at)) problems.push('generated_at');
    return problems;
}

/** Mirrors attentionResponseSchema. */
function attentionShapeProblems(data) {
    const problems = [];
    if (!data || !Array.isArray(data.items)) return ['items'];
    if (!nonNegativeInt(data.truncated_count)) problems.push('truncated_count');
    if (typeof data.conversation_scan_truncated !== 'boolean') problems.push('conversation_scan_truncated');
    if (!isIsoDate(data.generated_at)) problems.push('generated_at');
    data.items.forEach((item, index) => {
        const ok = typeof item?.id === 'string'
            && Number.isInteger(item.tier) && item.tier >= 1 && item.tier <= 5
            && typeof item.urgency_score === 'number'
            && SIGNAL_TYPES.has(item.signal_type)
            && typeof item.reason === 'string'
            && ['order', 'conversation', 'product'].includes(item.entity?.type)
            && typeof item.entity?.id === 'string';
        if (!ok) problems.push(`items[${index}]`);
    });
    return problems;
}

async function signIn(label, email, password) {
    const res = await call('POST', '/api/auth/native/signin', { body: { email, password } });
    const data = res.json?.data;
    if (res.status === 200 && data?.accessToken && data?.refreshToken && data?.sid) {
        openSessions.set(label, { ...data });
    }
    return res;
}

async function logout(label) {
    const session = openSessions.get(label);
    if (!session) return null;
    const res = await call('POST', '/api/auth/native/logout', {
        token: session.accessToken,
        body: { refresh_token: session.refreshToken },
    });
    openSessions.delete(label);
    return res;
}

/** A structurally valid JWT signed with a key the server has never seen. */
function forgedToken() {
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = b64({ alg: 'HS256', typ: 'JWT' });
    const payload = b64({
        userId: randomUuid(), shopId: randomUuid(), sid: randomUuid(), tokenVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 600,
    });
    const signature = crypto.createHmac('sha256', crypto.randomBytes(32)).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
}

async function platformChecks() {
    const version = await call('GET', '/api/version');
    record('platform: API serves the expected commit', version.status === 200 && version.json?.gitSha === env.EXPECTED_SHA,
        `${describe(version)} gitSha=${version.json?.gitSha || '(missing)'}`);

    const ready = await call('GET', '/health/ready');
    record('platform: /health/ready reports PostgreSQL and Redis', ready.status === 200
        && ready.json?.status === 'ready' && ready.json?.database === 'connected' && ready.json?.redis === 'connected',
    `${describe(ready)} database=${ready.json?.database} redis=${ready.json?.redis}`);

    for (const [name, url] of [['web app', APP_URL], ['Growth OS', GROWTH_URL]]) {
        const res = await call('GET', '/', { base: url, headers: { Accept: 'text/html' } });
        record(`platform: ${name} serves its page`, res.status === 200, describe(res));
    }

    await expectStatus('web: a cookie-less /api/auth/me is still refused as before', () => call('GET', '/api/auth/me'), 401);
}

async function disabledChecks() {
    await expectStatus('rollback: native sign-in is indistinguishable from an unknown route',
        () => call('POST', '/api/auth/native/signin', { body: { email: 'nobody@easymod.invalid', password: 'x' } }), 404);
    await expectStatus('rollback: native refresh is 404',
        () => call('POST', '/api/auth/native/refresh', { body: { refresh_token: 'x' } }), 404);
    await expectStatus('rollback: native sessions are 404', () => call('GET', '/api/auth/native/sessions'), 404);
    await expectStatus('rollback: /api/mobile/today is 404', () => call('GET', '/api/mobile/today'), 404);
    await expectStatus('rollback: /api/mobile/attention is 404', () => call('GET', '/api/mobile/attention'), 404);
}

async function anonymousChecks() {
    await expectStatus('auth: no token is refused', () => call('GET', '/api/mobile/today'), 401);
    await expectStatus('auth: a malformed bearer token is refused',
        () => call('GET', '/api/mobile/attention', { token: 'not-a-jwt' }), 401);
    await expectStatus('auth: a forged native token (unknown key) is refused',
        () => call('GET', '/api/mobile/today', { token: forgedToken() }), 401);
    // The fixture controller mounts BEFORE authenticate and answers 404 to a bad
    // control token. Reaching authenticate's 401 proves it is not mounted.
    await expectStatus('fixtures: the device-E2E control route is not mounted in production',
        () => call('POST', '/api/mobile/e2e/control', {
            token: 'not-a-jwt',
            headers: { 'X-Mobile-E2E-Control': crypto.randomBytes(32).toString('hex') },
            body: { action: 'reset' },
        }), 401);
    await expectStatus('csrf: a native sign-in that also carries a cookie is not CSRF-exempt',
        () => call('POST', '/api/auth/native/signin', {
            headers: { Cookie: 'easymod_probe=1' },
            body: { email: 'nobody@easymod.invalid', password: 'x' },
        }), 403);
    await expectStatus('auth: an unknown account is refused',
        () => call('POST', '/api/auth/native/signin', { body: { email: `proof-${randomUuid()}@easymod.invalid`, password: 'x' } }), 401);

    const twoFactor = await call('POST', '/api/auth/native/2fa/verify', {
        body: { tempToken: crypto.randomBytes(32).toString('hex'), token: '000000' },
    });
    record('2fa: an unknown challenge is refused and the verify route is rate limited',
        twoFactor.status === 401 && twoFactor.headers.get('ratelimit-limit') === '5',
        `${describe(twoFactor)} ratelimit-limit=${twoFactor.headers.get('ratelimit-limit')}`);
}

async function homeChecks(label) {
    const { accessToken } = openSessions.get(label);
    const today = await call('GET', '/api/mobile/today', { token: accessToken });
    const todayProblems = todayShapeProblems(today.json?.data);
    record(`home (${label}): /api/mobile/today returns the Today contract`, today.status === 200 && todayProblems.length === 0,
        `${describe(today)}${todayProblems.length ? ` shape: ${todayProblems.join(',')}` : ` orders=${today.json.data.order_count}`}`);

    const attention = await call('GET', '/api/mobile/attention', { token: accessToken });
    const data = attention.json?.data;
    const attentionProblems = attentionShapeProblems(data);
    const kinds = {};
    (data?.items || []).forEach((item) => { kinds[item.signal_type] = (kinds[item.signal_type] || 0) + 1; });
    record(`home (${label}): /api/mobile/attention returns the Attention contract`, attention.status === 200 && attentionProblems.length === 0,
        `${describe(attention)}${attentionProblems.length ? ` shape: ${attentionProblems.join(',')}` : ` items=${data.items.length} ${JSON.stringify(kinds)}`}`);
    return data?.items || [];
}

async function merchantChecks() {
    const email = env.MERCHANT_EMAIL;
    const password = env.MERCHANT_PASSWORD;
    if (!email || !password) {
        record('merchant: designated test identity is configured', false, 'MERCHANT_EMAIL/MERCHANT_PASSWORD missing');
        return;
    }

    // One wrong password, cleared by the successful sign-in that follows.
    const wrong = await call('POST', '/api/auth/native/signin', { body: { email, password: `${password}-wrong` } });
    record('auth: a wrong password is refused without revealing the account',
        wrong.status === 401 && wrong.json?.data === undefined, describe(wrong));

    const first = await signIn('A', email, password);
    if (first.json?.data?.requires2fa) {
        record('auth: the designated test merchant signs in', false, 'account unexpectedly requires 2FA');
        return;
    }
    const a = openSessions.get('A');
    record('auth: the designated test merchant signs in and gets a shop-bound native session',
        first.status === 200 && Boolean(a?.shopId) && String(a?.user?.email).toLowerCase() === email.toLowerCase(),
        describe(first));
    if (!a) return;

    const items = await homeChecks('A');
    const order = items.find((item) => item.entity.type === 'order');
    const conversation = items.find((item) => item.entity.type === 'conversation');
    if (order) outputs.order_id = order.entity.id;
    if (conversation) outputs.conversation_id = conversation.entity.id;

    for (const [type, item] of [['order', order], ['conversation', conversation]]) {
        if (!item) {
            record(`deep link: ${type} detail read for a real Home entity`, null, `no ${type} entity on Home`);
            continue;
        }
        // The app opens an entity only when data.id is the requested id
        // (EasyMod-mobile/src/lib/deeplink-entity.ts); hold the API to the same rule.
        const res = await call('GET', `/api/${type}/${item.entity.id}`, { token: a.accessToken });
        record(`deep link: ${type} detail read for a real Home entity`,
            res.status === 200 && res.json?.data?.id === item.entity.id, describe(res));
    }
    for (const type of ['order', 'conversation']) {
        await expectStatus(`isolation: an ${type} id outside this shop is not found`,
            () => call('GET', `/api/${type}/${randomUuid()}`, { token: a.accessToken }), 404);
    }

    await expectStatus('native scope: order creation is refused (read-only token)',
        () => call('POST', '/api/order', { token: a.accessToken, body: {} }), 403, 'NATIVE_READ_ONLY');
    await expectStatus('native scope: order update is refused (read-only token)',
        () => call('PATCH', `/api/order/${order?.entity.id || randomUuid()}`, { token: a.accessToken, body: { notes: 'proof' } }),
        403, 'NATIVE_READ_ONLY');
    for (const path of ['/api/order', '/api/dashboard', '/api/auth/me', '/api/admin/dashboard', '/api/internal/growth-os/prospects']) {
        await expectStatus(`native scope: ${path} is outside the mobile allowlist`,
            () => call('GET', path, { token: a.accessToken }), 403, 'NATIVE_ROUTE_NOT_ALLOWED');
    }
    await expectStatus('isolation: switching to a shop without membership is refused',
        () => call('POST', '/api/auth/native/switch-shop', { token: a.accessToken, body: { shopId: randomUuid() } }), 403);

    const sessions = await call('GET', '/api/auth/native/sessions', { token: a.accessToken });
    const current = (sessions.json?.data?.sessions || []).filter((session) => session.isCurrent);
    record('sessions: the device session list marks exactly this session as current',
        sessions.status === 200 && current.length === 1 && current[0].id === a.sid, describe(sessions));

    // Rotation, then replay of the rotated token: the whole session must die.
    const rotated = await call('POST', '/api/auth/native/refresh', { body: { refresh_token: a.refreshToken } });
    const next = rotated.json?.data;
    record('sessions: refresh rotates the token pair and restores shop + user',
        rotated.status === 200 && Boolean(next?.accessToken) && next?.refreshToken !== a.refreshToken
        && next?.shopId === a.shopId && Boolean(next?.user), describe(rotated));
    if (next?.accessToken) {
        await expectStatus('sessions: the rotated access token works',
            () => call('GET', '/api/mobile/today', { token: next.accessToken }), 200);
        await expectStatus('sessions: replaying the superseded refresh token is detected',
            () => call('POST', '/api/auth/native/refresh', { body: { refresh_token: a.refreshToken } }), 401);
        await expectStatus('sessions: reuse detection revoked the session on its next request',
            () => call('GET', '/api/mobile/today', { token: next.accessToken }), 401);
        await expectStatus('sessions: the newest refresh token died with the session',
            () => call('POST', '/api/auth/native/refresh', { body: { refresh_token: next.refreshToken } }), 401);
    }
    openSessions.delete('A');

    // Remote revocation from another device.
    await signIn('B', email, password);
    await signIn('C', email, password);
    const b = openSessions.get('B');
    const c = openSessions.get('C');
    record('sessions: two more devices sign in', Boolean(b && c), `${openSessions.size} open`);
    if (b && c) {
        await expectStatus('revocation: one device revokes another',
            () => call('DELETE', `/api/auth/native/sessions/${b.sid}`, { token: c.accessToken }), 200);
        await expectStatus('revocation: the revoked device is refused on its next request',
            () => call('GET', '/api/mobile/today', { token: b.accessToken }), 401);
        await expectStatus('revocation: the revoked device cannot refresh',
            () => call('POST', '/api/auth/native/refresh', { body: { refresh_token: b.refreshToken } }), 401);
        openSessions.delete('B');

        const out = await logout('C');
        record('logout: the device signs out', out?.status === 200, out ? describe(out) : 'no session');
        await expectStatus('logout: the signed-out access token is refused',
            () => call('GET', '/api/mobile/today', { token: c.accessToken }), 401);
        await expectStatus('logout: the signed-out refresh token is refused',
            () => call('POST', '/api/auth/native/refresh', { body: { refresh_token: c.refreshToken } }), 401);
    }

    const again = await signIn('D', email, password);
    record('relogin: the merchant signs back in after logout', again.status === 200 && openSessions.has('D'), describe(again));
    if (openSessions.has('D')) await homeChecks('D');
}

async function superAdminChecks() {
    const email = env.ADMIN_EMAIL;
    const password = env.ADMIN_PASSWORD;
    if (!email || !password) {
        record('super admin: native token stays inside the mobile surface', null, 'no SUPER_ADMIN review credential configured');
        return;
    }
    const res = await signIn('E', email, password);
    if (res.status === 200 && res.json?.data?.requires2fa) {
        record('2fa: a 2FA-enabled production account gets a challenge, not a session',
            Boolean(res.json.data.tempToken) && !res.json.data.accessToken, describe(res));
        return;
    }
    if (res.status !== 200 || !openSessions.has('E')) {
        record('super admin: native token stays inside the mobile surface', null,
            `sign-in not completed (${describe(res)}); not retried`);
        return;
    }
    const e = openSessions.get('E');
    const d = openSessions.get('D');
    await expectStatus('super admin: the platform admin API is refused to a native token',
        () => call('GET', '/api/admin/dashboard', { token: e.accessToken }), 403, 'NATIVE_ROUTE_NOT_ALLOWED');
    await expectStatus('super admin: a native token cannot write',
        () => call('POST', '/api/order', { token: e.accessToken, body: {} }), 403, 'NATIVE_READ_ONLY');
    const adminItems = await call('GET', '/api/mobile/attention', { token: e.accessToken });
    record('super admin: Home reads only its own shop', adminItems.status === 200, describe(adminItems));

    // Cross-shop, with two real test shops: each token must 404 the other's entities.
    if (d && e.shopId !== d.shopId) {
        const foreign = (adminItems.json?.data?.items || []).find((item) => ['order', 'conversation'].includes(item.entity.type));
        if (foreign) {
            await expectStatus(`isolation: the merchant cannot read another shop's real ${foreign.entity.type}`,
                () => call('GET', `/api/${foreign.entity.type}/${foreign.entity.id}`, { token: d.accessToken }), 404);
        } else {
            record('isolation: cross-shop read of a real foreign entity', null, 'second shop has no order/conversation on Home');
        }
        if (outputs.order_id) {
            await expectStatus('isolation: another shop cannot read the merchant\'s real order',
                () => call('GET', `/api/order/${outputs.order_id}`, { token: e.accessToken }), 404);
        }
    }
}

async function cleanup() {
    for (const label of [...openSessions.keys()]) {
        const res = await logout(label).catch(() => null);
        record(`cleanup: session ${label} signed out`, res?.status === 200, res ? describe(res) : 'request failed');
    }
}

function report() {
    const width = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.result.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
    const failed = results.filter((r) => r.result === 'FAIL').length;
    const skipped = results.filter((r) => r.result === 'SKIP').length;
    console.log(`\n${results.length} checks: ${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
    if (env.REPORT_PATH) {
        fs.writeFileSync(env.REPORT_PATH, `${JSON.stringify({
            mode: MODE, api: API.origin, expectedSha: env.EXPECTED_SHA, client: CLIENT,
            finishedAt: new Date().toISOString(), results,
        }, null, 2)}\n`);
    }
    if (env.GITHUB_OUTPUT) {
        fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
    }
    return failed;
}

async function main() {
    if (!/^[0-9a-f]{40}$/.test(env.EXPECTED_SHA || '')) throw new Error('EXPECTED_SHA must be a full commit SHA');
    if (!['enabled', 'disabled'].includes(MODE)) throw new Error('EXPECT_MOBILE_API must be enabled or disabled');
    if (API.protocol !== 'https:') throw new Error('API_BASE_URL must be https');

    try {
        await platformChecks();
        if (MODE === 'disabled') {
            await disabledChecks();
        } else {
            await anonymousChecks();
            await merchantChecks();
            await superAdminChecks();
        }
    } catch (error) {
        record('proof: completed without an unexpected error', false, error.name);
    } finally {
        await cleanup();
    }
    process.exitCode = report() > 0 ? 1 : 0;
}

main().catch((error) => {
    console.error(`mobile production proof could not start: ${error.message}`);
    process.exitCode = 2;
});
