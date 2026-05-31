#!/usr/bin/env node
'use strict';

/**
 * Launch-readiness gate — one command that answers "are we safe to launch?".
 *
 * It probes the running API and checks every hard gate from the launch plan:
 *   1. Infra up            — /health/ready returns 200
 *   2. DB + Redis + Vector — /health/detailed: database, redis, qdrant all OK
 *   3. Auto-reply DLQ empty — no messages failed every retry
 *   4. Auto-reply canary fresh — the message worker is consuming the queue
 *   5. Activation target   — >= N shops reached their first AI reply
 *   6. Retention (info)     — shops still transacting this week
 *
 * Usage:
 *   BASE_URL=https://easymod.tech ADMIN_TOKEN=<jwt> node scripts/launch-readiness.js
 *   # optional: ACTIVATION_TARGET=10 (default 10)
 *
 * Exit code 0 = all hard gates pass; 1 = at least one failed (CI/automation-friendly).
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ACTIVATION_TARGET = parseInt(process.env.ACTIVATION_TARGET || '10', 10);

const authHeaders = ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};

async function getJson(path, useAuth) {
    try {
        const res = await fetch(`${BASE_URL}${path}`, { headers: useAuth ? authHeaders : {} });
        const body = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, body };
    } catch (err) {
        return { ok: false, status: 0, body: null, error: err.message };
    }
}

(async () => {
    console.log(`\nLaunch readiness — ${BASE_URL}\n${'='.repeat(60)}`);

    const gates = [];
    const addGate = (name, pass, detail) => gates.push({ name, pass: Boolean(pass), detail });

    // 1. Infra
    const ready = await getJson('/health/ready', false);
    addGate('Infra up (/health/ready 200)', ready.status === 200,
        ready.status === 200 ? 'ok' : `status=${ready.status}${ready.error ? ` (${ready.error})` : ''}`);

    // 2–4. Detailed health (auth)
    const detailed = await getJson('/health/detailed', true);
    const d = detailed.body || {};
    if (!detailed.ok) {
        addGate('DB + Redis + Vector store', false, `/health/detailed status=${detailed.status} (need a valid ADMIN_TOKEN)`);
        addGate('Auto-reply DLQ empty', false, 'unknown — /health/detailed not reachable');
        addGate('Auto-reply canary fresh', false, 'unknown — /health/detailed not reachable');
    } else {
        addGate('DB + Redis + Vector store',
            d.database === 'connected' && d.redis === 'connected' && d.vectorDb === 'available',
            `db=${d.database} redis=${d.redis} vector=${d.vectorDb} (${d.vectorProvider})`);
        addGate('Auto-reply DLQ empty', (d.autoReplyDlq || 0) === 0, `dlq=${d.autoReplyDlq ?? 'n/a'}`);
        addGate('Auto-reply canary fresh', d.autoReplyCanary?.fresh === true,
            d.autoReplyCanary?.lastOkAgeMs == null ? 'no canary heartbeat yet' : `last ok ${Math.round(d.autoReplyCanary.lastOkAgeMs / 1000)}s ago`);
    }

    // 5–6. Growth (auth, admin)
    const growth = await getJson('/api/analytics/growth', true);
    if (!growth.ok) {
        addGate(`Activation >= ${ACTIVATION_TARGET} shops`, false, `/api/analytics/growth status=${growth.status} (admin token required)`);
    } else {
        const t = growth.body?.data?.totals || {};
        addGate(`Activation >= ${ACTIVATION_TARGET} shops`, (t.activated || 0) >= ACTIVATION_TARGET,
            `${t.activated || 0}/${t.shops || 0} shops activated (${t.activationRate || 0}%)`);
        // Retention is informational at launch, not a hard gate.
        console.log(`\nℹ️  Retention (info): ${t.retainedThisWeek || 0} of ${t.activated || 0} activated shops `
            + `transacted this week (${t.retentionRate || 0}%).`);
    }

    // Report
    console.log(`\n${'-'.repeat(60)}`);
    for (const g of gates) {
        console.log(`${g.pass ? '✅ PASS' : '❌ FAIL'}  ${g.name}\n          ${g.detail}`);
    }
    console.log('-'.repeat(60));

    const allPass = gates.every(g => g.pass);
    console.log(allPass
        ? '\n🟢 ALL HARD GATES PASS — safe to launch.\n'
        : '\n🔴 NOT READY — one or more hard gates failed (see above).\n');

    process.exit(allPass ? 0 : 1);
})();
