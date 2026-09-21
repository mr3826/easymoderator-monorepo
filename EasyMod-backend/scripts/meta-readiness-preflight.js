#!/usr/bin/env node
'use strict';

/**
 * Meta login readiness preflight. Read-only; makes one public GET and reads no
 * secrets (META_APP_SECRET is deliberately never touched).
 *
 * It automates only what a repo script can honestly verify:
 *   - META_OAUTH_REDIRECT_URI has exactly the shape Meta's whitelist expects
 *     (the host is NOT verified: only Meta's dashboard knows what is whitelisted)
 *   - the public data-deletion instructions endpoint is live
 *
 * It CANNOT read Meta's app configuration (access levels, Access Verification,
 * login product, app mode, registered URLs): those are only exposed by the
 * dashboard and by Meta's developer-tools MCP. They are printed as UNVERIFIED on
 * every run so a clean exit is never mistaken for "Meta is ready". The incident
 * of 2026-09-22 was exactly such a Meta-side gap
 * (docs/incidents/2026-09-22-meta-login-unavailable.md).
 *
 * Usage: node scripts/meta-readiness-preflight.js
 *   META_OAUTH_REDIRECT_URI  callback URL to shape-check (optional; SKIP if unset)
 *   API_BASE_URL             defaults to https://api.easymod.tech (https only,
 *                            except localhost); redirects are not followed
 * Exit code: 0 = no automated check failed (skips are reported, not failures),
 *            1 = an automated check failed.
 */

const DEFAULT_API_BASE = 'https://api.easymod.tech';
const CALLBACK_PATH = '/channels/oauth-callback';
const TIMEOUT_MS = 10000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const MANUAL_CHECKS = [
    ['public_profile is at Advanced Access', 'App Review > Permissions and Features, or devtools_app_review privileges'],
    ['Login product (Facebook Login vs Facebook Login for Business) and its configuration', 'App Dashboard > Facebook Login'],
    ['Access Verification (Tech Provider) is completed', 'App settings > Basic > Business portfolio > Access verification'],
    ['pages_show_list, pages_messaging, pages_manage_metadata are Advanced and live', 'devtools_app_review privileges'],
    ['App mode is Live', 'devtools_app basic_settings'],
    ['User Data Deletion URL is registered and matches the live endpoint', 'App settings > Basic'],
    ['Contact email is verified and the app description / support URL are filled in', 'App settings > Basic'],
    ['Valid OAuth redirect URI matches META_OAUTH_REDIRECT_URI exactly', 'devtools_app advanced_settings'],
    ['Compliance has no required actions or violations', 'devtools_compliance status'],
];

function checkRedirectUri(value) {
    if (!value) return { status: 'SKIP', detail: 'META_OAUTH_REDIRECT_URI not set' };
    let url;
    try {
        url = new URL(value);
    } catch (_) {
        return { status: 'FAIL', detail: 'not a valid URL' };
    }
    if (url.protocol !== 'https:') return { status: 'FAIL', detail: 'must be https' };

    // Meta matches the string exactly and the runtime sends the raw env value, so
    // compare the raw string, not the WHATWG-normalised URL (which silently drops
    // ports, credentials, case and whitespace). The raw value is never echoed.
    const canonical = `${url.origin}${CALLBACK_PATH}`;
    if (value !== canonical) {
        return {
            status: 'FAIL',
            detail: `must be exactly an https origin followed by ${CALLBACK_PATH}, with no whitespace, port, credentials, query, fragment, dot-segments or trailing slash`,
        };
    }
    return { status: 'PASS', detail: `${canonical} (shape only; host not verified against Meta)` };
}

function checkApiBase(apiBase) {
    let url;
    try {
        url = new URL(apiBase);
    } catch (_) {
        return { status: 'FAIL', detail: 'API_BASE_URL is not a valid URL' };
    }
    const local = LOCAL_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
        return { status: 'FAIL', detail: 'API_BASE_URL must be https (http is allowed only for localhost)' };
    }
    return { status: 'PASS', detail: url.origin };
}

function checkDeletionEndpoint(result, probedUrl) {
    const where = probedUrl ? ` (${probedUrl})` : '';
    if (!result || result.error === 'unreachable') return { status: 'FAIL', detail: `endpoint unreachable${where}` };
    if (result.error === 'timeout') return { status: 'FAIL', detail: `no response within ${TIMEOUT_MS / 1000}s${where}` };
    if (result.status >= 300 && result.status < 400) {
        return { status: 'FAIL', detail: `HTTP ${result.status} redirect; redirects are not followed${where}` };
    }
    if (result.status !== 200) return { status: 'FAIL', detail: `HTTP ${result.status}${where}` };
    const body = result.body;
    if (!body || typeof body !== 'object' || !Array.isArray(body.instructions) || !body.contact) {
        return { status: 'FAIL', detail: `HTTP 200 but not the deletion-instructions JSON${where}` };
    }
    return { status: 'PASS', detail: `HTTP 200, deletion instructions present${where}` };
}

async function fetchDeletionEndpoint(url, fetchImpl) {
    try {
        const res = await fetchImpl(url, {
            headers: { accept: 'application/json' },
            redirect: 'manual',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        let body = null;
        try {
            body = await res.json();
        } catch (_) { /* non-JSON body is reported by checkDeletionEndpoint */ }
        return { status: res.status, body };
    } catch (err) {
        return { error: err && err.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
    }
}

async function run({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
    const apiBase = (env.API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '');
    const deletionUrl = `${apiBase}/webhooks/meta/data-deletion`;

    const apiBaseCheck = checkApiBase(apiBase);
    let deletionCheck;
    if (apiBaseCheck.status === 'FAIL') {
        deletionCheck = { status: 'SKIP', detail: 'not probed: API_BASE_URL rejected' };
    } else if (typeof fetchImpl !== 'function') {
        deletionCheck = { status: 'FAIL', detail: 'global fetch is unavailable (Node 18+ required)' };
    } else {
        deletionCheck = checkDeletionEndpoint(await fetchDeletionEndpoint(deletionUrl, fetchImpl), deletionUrl);
    }

    const results = [
        ['redirect URI shape', checkRedirectUri(env.META_OAUTH_REDIRECT_URI)],
        ['API base URL', apiBaseCheck],
        ['data-deletion endpoint live', deletionCheck],
    ];

    log('Meta login readiness preflight');
    log('--- automated ---');
    for (const [name, { status, detail }] of results) log(`${status.padEnd(4)}  ${name}: ${detail}`);
    log('--- UNVERIFIED: not machine-checkable from this repo; confirm in the dashboard ---');
    for (const [name, where] of MANUAL_CHECKS) log(`????  ${name}  [${where}]`);

    const count = (status) => results.filter(([, r]) => r.status === status).length;
    const failed = count('FAIL') > 0;
    log(failed
        ? `RESULT: FAIL - ${count('FAIL')} automated check(s) failed`
        : `RESULT: no automated check failed (${count('PASS')} passed, ${count('SKIP')} skipped). Meta-side readiness is UNKNOWN until the ???? items are confirmed.`);
    return failed ? 1 : 0;
}

if (require.main === module) {
    run()
        .then((code) => { process.exitCode = code; })
        .catch((err) => {
            console.error(`preflight crashed: ${err && err.name}`);
            process.exitCode = 1;
        });
}

module.exports = { run, checkRedirectUri, checkApiBase, checkDeletionEndpoint, MANUAL_CHECKS };
