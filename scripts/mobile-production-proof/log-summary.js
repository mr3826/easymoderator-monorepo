#!/usr/bin/env node
'use strict';

/**
 * Summarises production backend "Response sent" log lines from mobile clients
 * (docs/deployment/MOBILE_API_ACTIVATION_RUNBOOK.md, observability).
 *
 * stdin: JSON log lines already filtered on the droplet to `"client":"android/…"`.
 * stdout: per-client and per-route request counts, status classes and latency —
 * never user ids, shop ids, IPs or entity ids (UUIDs are collapsed to :id).
 *
 *   node log-summary.js <report.json> [proof client]
 *
 * Exits 1 when a mobile request answered 5xx, or when the proof client's own
 * traffic is missing from the logs (the pipeline would then be blind to it).
 */

const fs = require('fs');

const [reportPath, proofClient] = process.argv.slice(2);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null);

function summarise(lines) {
    const byClient = {};
    const byRoute = {};
    let serverErrors = 0;
    for (const line of lines) {
        let entry;
        try {
            entry = JSON.parse(line);
        } catch (_error) {
            continue;
        }
        if (entry.message !== 'Response sent' || typeof entry.client !== 'string') continue;
        const client = entry.client === proofClient ? 'proof' : entry.client;
        const route = `${entry.method} ${String(entry.path || '').replace(UUID, ':id')}`;
        const statusClass = `${String(entry.statusCode).charAt(0)}xx`;
        if (statusClass === '5xx') serverErrors += 1;

        byClient[client] = byClient[client] || { requests: 0, statuses: {} };
        byClient[client].requests += 1;
        byClient[client].statuses[entry.statusCode] = (byClient[client].statuses[entry.statusCode] || 0) + 1;

        byRoute[route] = byRoute[route] || { requests: 0, statuses: {}, durations: [] };
        byRoute[route].requests += 1;
        byRoute[route].statuses[statusClass] = (byRoute[route].statuses[statusClass] || 0) + 1;
        if (Number.isFinite(entry.durationMs)) byRoute[route].durations.push(entry.durationMs);
    }

    const routes = Object.fromEntries(Object.entries(byRoute).sort().map(([route, value]) => {
        const sorted = value.durations.sort((a, b) => a - b);
        return [route, {
            requests: value.requests,
            statuses: value.statuses,
            p50Ms: percentile(sorted, 50),
            p95Ms: percentile(sorted, 95),
            maxMs: sorted.length ? sorted[sorted.length - 1] : null,
        }];
    }));
    return { byClient, routes, serverErrors };
}

const input = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean);
const summary = summarise(input);

console.log('Mobile traffic by client:');
for (const [client, value] of Object.entries(summary.byClient)) {
    console.log(`  ${client.padEnd(28)} ${String(value.requests).padStart(4)} requests  ${JSON.stringify(value.statuses)}`);
}
console.log('\nMobile traffic by route:');
for (const [route, value] of Object.entries(summary.routes)) {
    console.log(`  ${route.padEnd(48)} ${String(value.requests).padStart(4)}  ${JSON.stringify(value.statuses).padEnd(28)} p50=${value.p50Ms}ms p95=${value.p95Ms}ms max=${value.maxMs}ms`);
}
console.log(`\nmobile 5xx responses: ${summary.serverErrors}`);

if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);

const proofSeen = !proofClient || Boolean(summary.byClient.proof?.requests);
if (!proofSeen) console.error('the proof client\'s own requests are missing from the production logs');
process.exitCode = summary.serverErrors > 0 || !proofSeen ? 1 : 0;
