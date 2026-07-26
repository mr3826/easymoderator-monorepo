#!/usr/bin/env node
'use strict';

/**
 * Launch-readiness gate — one command that answers "are we safe to launch?".
 *
 * It probes the running API and checks every hard gate from the launch plan:
 *   1. Infra up             — /health/ready answers from the BACKEND and is ready
 *   2. DB + Redis + Vector  — /health/detailed: database, redis, qdrant all OK
 *   3. Auto-reply DLQ empty — no outbound reply failed every retry
 *   4. Inbound webhook DLQ  — no inbound Meta event was dropped after every retry
 *   5. Auto-reply canary    — the message worker is consuming the queue
 *   6. Activation target    — >= N shops reached their first AI reply
 *   7. Retention (info)     — shops still transacting this week
 *
 * FAIL-CLOSED CONTRACT (finding F-05, 2026-07-26 audit)
 * -----------------------------------------------------
 * This script is the instrument used to decide whether real merchants can be
 * onboarded. It previously reported PASS for conditions it could not observe:
 * `/health/ready` was answered by the SPA's nginx container with a hardcoded
 * `{"status":"ready"}`, and `(d.autoReplyDlq || 0) === 0` turned an absent DLQ
 * depth into a green gate. Both are now impossible:
 *
 *   - A 200 is never sufficient. Every response must carry
 *     `service: "easymod-backend"`, so a proxy/static-host stub fails provenance.
 *   - Counters must be real integers. Absent, null, or string values FAIL —
 *     never `|| 0`.
 *   - Every required field must be present and of the expected type; an
 *     unrecognised schema FAILS rather than falling through to a default.
 *   - An endpoint that cannot be read (401/timeout/parse error) is UNVERIFIED,
 *     which counts as FAIL. Nothing unknown is ever reported as green.
 *
 * Usage:
 *   BASE_URL=https://easymod.tech ADMIN_TOKEN=<jwt> node scripts/launch-readiness.js
 *   # optional: ACTIVATION_TARGET=10 (default 10)
 *
 * Exit code 0 = all hard gates pass; 1 = at least one failed (CI/automation-friendly).
 */

const SERVICE_MARKER = 'easymod-backend';

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

/**
 * Provenance check. The frontend container used to answer these paths; anything
 * that does not identify itself as the backend is treated as no answer at all.
 */
const isBackendBody = (body) => isPlainObject(body) && body.service === SERVICE_MARKER;

function describeBody(body) {
    if (body === null || body === undefined) return 'no JSON body';
    if (!isPlainObject(body)) return `unexpected body type (${typeof body})`;
    if (typeof body.service !== 'string') return 'body has no "service" field — not a backend response';
    return `body.service="${body.service}" — expected "${SERVICE_MARKER}"`;
}

/**
 * Evaluate every hard gate from already-fetched responses.
 *
 * Pure and side-effect free so the fail-closed behaviour can be unit tested
 * against fixtures (including a frontend/nginx-shaped response).
 *
 * @param {object} input
 * @param {{status:number, ok:boolean, body:any, error?:string}} input.ready
 * @param {{status:number, ok:boolean, body:any, error?:string}} input.detailed
 * @param {{status:number, ok:boolean, body:any, error?:string}} input.growth
 * @param {number} input.activationTarget
 * @returns {Array<{name:string, pass:boolean, detail:string}>}
 */
function evaluateGates({ ready, detailed, growth, activationTarget }) {
    const gates = [];
    const addGate = (name, pass, detail) => gates.push({ name, pass: Boolean(pass), detail });

    // ── 1. Infra up ──────────────────────────────────────────────────────────
    if (ready.status !== 200) {
        addGate('Infra up (/health/ready 200)', false,
            `status=${ready.status}${ready.error ? ` (${ready.error})` : ''}`);
    } else if (!isBackendBody(ready.body)) {
        addGate('Infra up (/health/ready 200)', false,
            `200 but NOT from the backend — ${describeBody(ready.body)}`);
    } else if (ready.body.status !== 'ready') {
        addGate('Infra up (/health/ready 200)', false, `backend reports status="${ready.body.status}"`);
    } else if (ready.body.database !== 'connected') {
        addGate('Infra up (/health/ready 200)', false, `backend reports database="${ready.body.database}"`);
    } else {
        addGate('Infra up (/health/ready 200)', true,
            `ok (commit=${ready.body.commit || 'unknown'})`);
    }

    // ── 2–5. Detailed health (authenticated) ─────────────────────────────────
    const unreadable = !detailed.ok
        ? `/health/detailed status=${detailed.status}${detailed.status === 401 ? ' (need a valid ADMIN_TOKEN)' : ''}`
        : (!isBackendBody(detailed.body) ? `not a backend response — ${describeBody(detailed.body)}` : null);

    if (unreadable) {
        // UNVERIFIED is a failure. It is never reported as zero, empty, or healthy.
        addGate('DB + Redis + Vector store', false, `unverified — ${unreadable}`);
        addGate('Auto-reply DLQ empty', false, `unverified — ${unreadable}`);
        addGate('Inbound webhook DLQ empty', false, `unverified — ${unreadable}`);
        addGate('Auto-reply canary fresh', false, `unverified — ${unreadable}`);
    } else {
        const d = detailed.body;

        const infraFields = ['database', 'redis', 'vectorDb'];
        const missingInfra = infraFields.filter((f) => typeof d[f] !== 'string');
        if (missingInfra.length) {
            addGate('DB + Redis + Vector store', false,
                `unexpected schema — missing/invalid field(s): ${missingInfra.join(', ')}`);
        } else {
            addGate('DB + Redis + Vector store',
                d.database === 'connected' && d.redis === 'connected' && d.vectorDb === 'available',
                `db=${d.database} redis=${d.redis} vector=${d.vectorDb} (${d.vectorProvider || 'unknown provider'})`);
        }

        // Absent/null/string depth FAILS. `(d.autoReplyDlq || 0) === 0` is exactly
        // the coercion that produced a green gate with "dlq=n/a".
        if (!isCount(d.autoReplyDlq)) {
            addGate('Auto-reply DLQ empty', false,
                `unverified — autoReplyDlq is ${JSON.stringify(d.autoReplyDlq)}, expected a non-negative integer`);
        } else {
            addGate('Auto-reply DLQ empty', d.autoReplyDlq === 0, `dlq=${d.autoReplyDlq}`);
        }

        const receipts = d.webhookReceipts;
        if (!isPlainObject(receipts) || !isCount(receipts.deadLettered)) {
            addGate('Inbound webhook DLQ empty', false,
                `unverified — webhookReceipts.deadLettered is ${JSON.stringify(receipts?.deadLettered)}, `
                + 'expected a non-negative integer');
        } else {
            addGate('Inbound webhook DLQ empty', receipts.deadLettered === 0,
                `deadLettered=${receipts.deadLettered}`
                + (isCount(receipts.held) ? ` held=${receipts.held}` : ''));
        }

        const canary = d.autoReplyCanary;
        if (!isPlainObject(canary)) {
            addGate('Auto-reply canary fresh', false, 'unverified — no autoReplyCanary field in the response');
        } else if (!Number.isInteger(canary.lastOkAgeMs)) {
            addGate('Auto-reply canary fresh', false, 'no canary heartbeat yet — the worker has never confirmed a run');
        } else if (canary.fresh !== true) {
            addGate('Auto-reply canary fresh', false,
                `STALE — last ok ${Math.round(canary.lastOkAgeMs / 1000)}s ago`);
        } else {
            addGate('Auto-reply canary fresh', true, `last ok ${Math.round(canary.lastOkAgeMs / 1000)}s ago`);
        }
    }

    // ── 6. Activation ────────────────────────────────────────────────────────
    const gateName = `Activation >= ${activationTarget} shops`;
    if (!growth.ok) {
        addGate(gateName, false,
            `unverified — /api/analytics/growth status=${growth.status}`
            + `${growth.status === 401 || growth.status === 403 ? ' (admin token required)' : ''}`);
    } else {
        const t = growth.body?.data?.totals;
        if (!isPlainObject(t) || !isCount(t.activated)) {
            addGate(gateName, false,
                `unexpected schema — data.totals.activated is ${JSON.stringify(t?.activated)}`);
        } else {
            addGate(gateName, t.activated >= activationTarget,
                `${t.activated}/${isCount(t.shops) ? t.shops : '?'} shops activated`);
        }
    }

    return gates;
}

async function getJson(baseUrl, path, headers) {
    try {
        const res = await fetch(`${baseUrl}${path}`, { headers: headers || {} });
        const body = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, body };
    } catch (err) {
        return { ok: false, status: 0, body: null, error: err.message };
    }
}

async function main() {
    const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
    const activationTarget = parseInt(process.env.ACTIVATION_TARGET || '10', 10);
    const authHeaders = ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};

    console.log(`\nLaunch readiness — ${BASE_URL}\n${'='.repeat(60)}`);
    if (!ADMIN_TOKEN) {
        console.log('⚠️  ADMIN_TOKEN is not set — authenticated gates will report UNVERIFIED (a failure).');
    }

    const [ready, detailed, growth] = await Promise.all([
        getJson(BASE_URL, '/health/ready', null),
        getJson(BASE_URL, '/health/detailed', authHeaders),
        getJson(BASE_URL, '/api/analytics/growth', authHeaders),
    ]);

    const gates = evaluateGates({ ready, detailed, growth, activationTarget });

    if (growth.ok && isPlainObject(growth.body?.data?.totals)) {
        const t = growth.body.data.totals;
        console.log(`\nℹ️  Retention (info): ${t.retainedThisWeek ?? 'unknown'} of ${t.activated ?? 'unknown'} `
            + `activated shops transacted this week.`);
    }

    console.log(`\n${'-'.repeat(60)}`);
    for (const g of gates) {
        console.log(`${g.pass ? '✅ PASS' : '❌ FAIL'}  ${g.name}\n          ${g.detail}`);
    }
    console.log('-'.repeat(60));

    const allPass = gates.every((g) => g.pass);
    console.log(allPass
        ? '\n🟢 ALL HARD GATES PASS — safe to launch.\n'
        : '\n🔴 NOT READY — one or more hard gates failed or could not be verified (see above).\n');

    return allPass ? 0 : 1;
}

module.exports = { evaluateGates, isBackendBody, SERVICE_MARKER };

if (require.main === module) {
    main()
        .then((code) => process.exit(code))
        .catch((err) => {
            console.error(`\n🔴 launch-readiness crashed: ${err.message}\n`);
            process.exit(1);
        });
}
