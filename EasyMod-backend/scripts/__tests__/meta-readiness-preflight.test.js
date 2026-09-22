'use strict';

const {
    run,
    checkRedirectUri,
    checkLoginConfigId,
    checkApiBase,
    checkDeletionEndpoint,
    MANUAL_CHECKS,
} = require('../meta-readiness-preflight');

const GOOD_REDIRECT = 'https://app.easymod.tech/channels/oauth-callback';
const GOOD_CONFIG_ID = '1685388446490514';
const DELETION_BODY = { instructions: ['Remove the app in Facebook settings.'], contact: 'privacy@easymod.tech' };

const okFetch = () => jest.fn().mockResolvedValue({ status: 200, json: async () => DELETION_BODY });

// A unit test must never reach the network: make any real fetch fail loudly.
beforeAll(() => {
    if (typeof globalThis.fetch === 'function') {
        jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
            throw new Error('unit test attempted a real fetch');
        });
    }
});

afterAll(() => jest.restoreAllMocks());

async function runCaptured(options) {
    const lines = [];
    const code = await run({ ...options, log: (line) => lines.push(line) });
    return { code, output: lines.join('\n') };
}

describe('checkRedirectUri', () => {
    test('accepts the production callback exactly', () => {
        expect(checkRedirectUri(GOOD_REDIRECT).status).toBe('PASS');
    });

    test.each([
        ['plain http', 'http://app.easymod.tech/channels/oauth-callback'],
        ['trailing slash', `${GOOD_REDIRECT}/`],
        ['wrong path', 'https://app.easymod.tech/oauth-callback'],
        ['query string', `${GOOD_REDIRECT}?x=1`],
        ['bare trailing question mark', `${GOOD_REDIRECT}?`],
        ['fragment', `${GOOD_REDIRECT}#x`],
        ['bare trailing hash', `${GOOD_REDIRECT}#`],
        ['trailing newline (secret-manager artefact)', `${GOOD_REDIRECT}\n`],
        ['leading space', ` ${GOOD_REDIRECT}`],
        ['explicit default port', 'https://app.easymod.tech:443/channels/oauth-callback'],
        ['uppercase host', 'https://APP.easymod.tech/channels/oauth-callback'],
        ['embedded credentials', 'https://user:pass@app.easymod.tech/channels/oauth-callback'],
        ['dot-segments', 'https://app.easymod.tech/x/../channels/oauth-callback'],
        ['unparsable value', 'not a url'],
    ])('rejects %s', (_label, value) => {
        expect(checkRedirectUri(value).status).toBe('FAIL');
    });

    test('never echoes a rejected value, so embedded credentials cannot leak into output', () => {
        const result = checkRedirectUri('https://user:hunter2@app.easymod.tech/channels/oauth-callback');
        expect(result.status).toBe('FAIL');
        expect(JSON.stringify(result)).not.toContain('hunter2');
    });

    test('skips when the variable is not set', () => {
        expect(checkRedirectUri(undefined).status).toBe('SKIP');
    });
});

describe('checkApiBase', () => {
    test.each([
        ['https origin', 'https://api.easymod.tech'],
        ['http localhost', 'http://localhost:3000'],
        ['http loopback', 'http://127.0.0.1:3000'],
    ])('accepts %s', (_label, value) => {
        expect(checkApiBase(value).status).toBe('PASS');
    });

    test.each([
        ['plain http to a real host', 'http://api.easymod.tech'],
        ['a non-http scheme', 'ftp://api.easymod.tech'],
        ['an unparsable value', 'api.easymod.tech'],
    ])('rejects %s', (_label, value) => {
        expect(checkApiBase(value).status).toBe('FAIL');
    });
});

describe('checkDeletionEndpoint', () => {
    test('passes on HTTP 200 with deletion instructions', () => {
        expect(checkDeletionEndpoint({ status: 200, body: DELETION_BODY }).status).toBe('PASS');
    });

    test('names the probed URL in its detail', () => {
        const result = checkDeletionEndpoint({ status: 404, body: null }, 'https://api.example.test/x');
        expect(result.detail).toContain('https://api.example.test/x');
    });

    test.each([
        ['an unreachable endpoint', { error: 'unreachable' }],
        ['a timeout', { error: 'timeout' }],
        ['no result at all', null],
        ['a 404', { status: 404, body: null }],
        ['a redirect', { status: 302, body: null }],
        ['HTTP 200 that is not JSON (e.g. an SPA shell)', { status: 200, body: null }],
        ['HTTP 200 JSON without instructions', { status: 200, body: { ok: true } }],
    ])('fails on %s', (_label, result) => {
        expect(checkDeletionEndpoint(result).status).toBe('FAIL');
    });

    test('reports a timeout distinctly from an unreachable endpoint', () => {
        expect(checkDeletionEndpoint({ error: 'timeout' }).detail).toMatch(/no response within/);
        expect(checkDeletionEndpoint({ error: 'unreachable' }).detail).toMatch(/unreachable/);
    });
});

describe('checkLoginConfigId', () => {
    test('accepts a bare numeric configuration ID', () => {
        expect(checkLoginConfigId(GOOD_CONFIG_ID).status).toBe('PASS');
    });

    test('never claims the configuration exists or is the right token type', () => {
        expect(checkLoginConfigId(GOOD_CONFIG_ID).detail).toMatch(/not verified against Meta/);
    });

    test.each([
        ['unset', undefined],
        ['empty', ''],
        ['a placeholder', 'CHANGE_ME'],
        ['quoted', '"1685388446490514"'],
        ['too short', '12345'],
        ['a comma-joined pair', '1685388446490514,35885387384409543'],
        ['carrying an injected parameter', '1685388446490514&scope=business_management'],
    ])('fails on %s', (_label, value) => {
        expect(checkLoginConfigId(value).status).toBe('FAIL');
    });

    test('does not echo the offending value back into output', () => {
        const detail = checkLoginConfigId('"1685388446490514"').detail;
        expect(detail).not.toContain('1685388446490514');
    });
});

describe('run', () => {
    test('exits 0 when no automated check fails, and still lists every unverified item', async () => {
        const { code, output } = await runCaptured({
            env: { META_OAUTH_REDIRECT_URI: GOOD_REDIRECT, META_LOGIN_CONFIG_ID: GOOD_CONFIG_ID },
            fetchImpl: okFetch(),
        });

        expect(code).toBe(0);
        for (const [name] of MANUAL_CHECKS) expect(output).toContain(name);
    });

    test('never reports Meta as ready: the verdict is UNKNOWN until manual items are confirmed', async () => {
        const { output } = await runCaptured({
            env: { META_OAUTH_REDIRECT_URI: GOOD_REDIRECT, META_LOGIN_CONFIG_ID: GOOD_CONFIG_ID },
            fetchImpl: okFetch(),
        });

        expect(output).toContain('Meta-side readiness is UNKNOWN');
    });

    test('says how many checks were skipped instead of calling a partial run a pass', async () => {
        const { code, output } = await runCaptured({
            env: { META_LOGIN_CONFIG_ID: GOOD_CONFIG_ID },
            fetchImpl: okFetch(),
        });

        expect(code).toBe(0);
        expect(output).toContain('SKIP  redirect URI shape');
        expect(output).toMatch(/3 passed, 1 skipped/);
        expect(output).not.toMatch(/automated checks passed/i);
    });

    // An unset configuration ID is not a skip: it is the 2026-09-22 defect
    // itself, so the preflight must fail rather than report a clean run.
    test('exits 1 when META_LOGIN_CONFIG_ID is unset', async () => {
        const { code, output } = await runCaptured({
            env: { META_OAUTH_REDIRECT_URI: GOOD_REDIRECT },
            fetchImpl: okFetch(),
        });

        expect(code).toBe(1);
        expect(output).toContain('FAIL  login configuration ID shape');
    });

    test('keeps the gates behind the 2026-09-22 incident on the unverified list', () => {
        const names = MANUAL_CHECKS.map(([name]) => name).join('\n');
        expect(names).toContain('public_profile is at Advanced Access');
        expect(names).toContain('META_LOGIN_CONFIG_ID');
        expect(names).toContain('USER access token configuration');
        expect(names).toContain('Access Verification (Tech Provider)');
    });

    test('exits 1 when the data-deletion endpoint is down', async () => {
        const { code, output } = await runCaptured({
            env: { META_OAUTH_REDIRECT_URI: GOOD_REDIRECT },
            fetchImpl: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        });

        expect(code).toBe(1);
        expect(output).toContain('RESULT: FAIL');
    });

    test('reports a timeout as a timeout', async () => {
        const timeout = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
        const { code, output } = await runCaptured({ env: {}, fetchImpl: jest.fn().mockRejectedValue(timeout) });

        expect(code).toBe(1);
        expect(output).toMatch(/no response within/);
    });

    test('does not follow redirects, and treats one as a failure', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ status: 302, json: async () => null });
        const { code, output } = await runCaptured({ env: {}, fetchImpl });

        expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
        expect(code).toBe(1);
        expect(output).toMatch(/redirect/);
    });

    test('fails clearly when global fetch is unavailable', async () => {
        // null (not undefined) so the destructuring default cannot fall back to real fetch.
        const { code, output } = await runCaptured({ env: {}, fetchImpl: null });

        expect(code).toBe(1);
        expect(output).toContain('global fetch is unavailable');
    });

    test('exits 1 when the redirect URI is malformed', async () => {
        const { code } = await runCaptured({
            env: { META_OAUTH_REDIRECT_URI: `${GOOD_REDIRECT}/` },
            fetchImpl: okFetch(),
        });

        expect(code).toBe(1);
    });

    test('rejects a non-https API_BASE_URL without making any request', async () => {
        const fetchImpl = okFetch();
        const { code, output } = await runCaptured({ env: { API_BASE_URL: 'http://api.example.test' }, fetchImpl });

        expect(code).toBe(1);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(output).toContain('must be https');
    });

    test('requests the deletion endpoint under the configured base, ignoring trailing slashes, and prints it', async () => {
        const fetchImpl = okFetch();
        const { output } = await runCaptured({ env: { API_BASE_URL: 'https://api.example.test//' }, fetchImpl });

        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.test/webhooks/meta/data-deletion');
        expect(output).toContain('https://api.example.test/webhooks/meta/data-deletion');
    });

    test('never reads or emits the app secret, even when it is present in the real process env', async () => {
        const canary = 'preflight-redaction-canary';
        const previous = process.env.META_APP_SECRET;
        process.env.META_APP_SECRET = canary;
        try {
            const fetchImpl = okFetch();
            // No `env` override: run() falls back to process.env, as the CLI does.
            const { output } = await runCaptured({ fetchImpl });

            expect(output).not.toContain(canary);
            expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain(canary);
        } finally {
            if (previous === undefined) delete process.env.META_APP_SECRET;
            else process.env.META_APP_SECRET = previous;
        }
    });
});
