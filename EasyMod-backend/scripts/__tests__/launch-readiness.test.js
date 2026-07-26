'use strict';

/**
 * Fail-closed contract for the launch-readiness gate (finding F-05).
 *
 * The gate is the instrument used to decide whether real merchants can be
 * onboarded. Every test here asserts that something UNKNOWN reports FAIL —
 * never zero, empty, healthy, or complete.
 */

const { evaluateGates } = require('../launch-readiness');

const ok = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, body });
const fail = (status, error) => ({ ok: false, status, body: null, error });

const healthyReady = () => ({
    service: 'easymod-backend',
    status: 'ready',
    database: 'connected',
    redis: 'connected',
    commit: 'abc1234',
});

const healthyDetailed = (overrides = {}) => ({
    service: 'easymod-backend',
    status: 'up',
    database: 'connected',
    redis: 'connected',
    vectorDb: 'available',
    vectorProvider: 'qdrant',
    autoReplyDlq: 0,
    webhookReceipts: { deadLettered: 0, held: 0 },
    autoReplyCanary: { lastOkAgeMs: 30_000, fresh: true },
    ...overrides,
});

const healthyGrowth = (activated = 12) => ({
    data: { totals: { shops: 20, activated, activationRate: 60, retainedThisWeek: 8 } },
});

/** The stub the SPA's nginx container used to return on /health/ready. */
const NGINX_READY_STUB = { status: 'ready', timestamp: '2026-07-26T05:00:00+00:00' };
/** The stub it used to return on /health/detailed. */
const NGINX_DETAILED_STUB = { status: 'healthy', server: 'nginx', timestamp: '2026-07-26T05:00:00+00:00' };

function run(overrides = {}) {
    return evaluateGates({
        ready: ok(healthyReady()),
        detailed: ok(healthyDetailed()),
        growth: ok(healthyGrowth()),
        activationTarget: 10,
        ...overrides,
    });
}

const gate = (gates, name) => gates.find((g) => g.name.startsWith(name));

describe('launch-readiness gate — happy path', () => {
    test('a fully healthy backend passes every hard gate', () => {
        const gates = run();
        expect(gates.every((g) => g.pass)).toBe(true);
        expect(gates).toHaveLength(6);
    });
});

describe('launch-readiness gate — infra reachability', () => {
    test('backend stopped: /health/ready unreachable fails', () => {
        const gates = run({ ready: fail(0, 'ECONNREFUSED') });
        expect(gate(gates, 'Infra up').pass).toBe(false);
        expect(gate(gates, 'Infra up').detail).toMatch(/ECONNREFUSED/);
    });

    test('503 from a real backend fails', () => {
        const gates = run({ ready: ok({ service: 'easymod-backend', status: 'not_ready' }, 503) });
        expect(gate(gates, 'Infra up').pass).toBe(false);
    });

    test('PostgreSQL unavailable fails readiness even on a 200', () => {
        const gates = run({ ready: ok({ ...healthyReady(), database: 'disconnected' }) });
        expect(gate(gates, 'Infra up').pass).toBe(false);
        expect(gate(gates, 'Infra up').detail).toMatch(/disconnected/);
    });
});

describe('launch-readiness gate — a 200 alone is never enough', () => {
    test('the nginx /health/ready stub FAILS provenance', () => {
        const gates = run({ ready: ok(NGINX_READY_STUB) });
        const g = gate(gates, 'Infra up');
        expect(g.pass).toBe(false);
        expect(g.detail).toMatch(/NOT from the backend/);
    });

    test('the nginx /health/detailed stub fails every dependent gate', () => {
        const gates = run({ detailed: ok(NGINX_DETAILED_STUB) });
        for (const name of ['DB + Redis + Vector', 'Auto-reply DLQ', 'Inbound webhook DLQ', 'Auto-reply canary']) {
            expect(gate(gates, name).pass).toBe(false);
            expect(gate(gates, name).detail).toMatch(/unverified/);
        }
    });

    test('an empty 200 body fails rather than defaulting to healthy', () => {
        const gates = run({ ready: ok(null), detailed: ok(null) });
        expect(gates.every((g) => g.pass === false || g.name.startsWith('Activation'))).toBe(true);
        expect(gate(gates, 'Infra up').pass).toBe(false);
    });
});

describe('launch-readiness gate — dependency health', () => {
    test('Redis unavailable fails', () => {
        const gates = run({ detailed: ok(healthyDetailed({ redis: 'disconnected' })) });
        expect(gate(gates, 'DB + Redis + Vector').pass).toBe(false);
    });

    test('Redis "not_configured" is not "connected" and fails', () => {
        const gates = run({ detailed: ok(healthyDetailed({ redis: 'not_configured' })) });
        expect(gate(gates, 'DB + Redis + Vector').pass).toBe(false);
    });

    test('Qdrant unavailable fails the detailed gate', () => {
        const gates = run({ detailed: ok(healthyDetailed({ vectorDb: 'unavailable' })) });
        expect(gate(gates, 'DB + Redis + Vector').pass).toBe(false);
    });

    test('a missing infra field fails as an unexpected schema', () => {
        const body = healthyDetailed();
        delete body.vectorDb;
        const gates = run({ detailed: ok(body) });
        expect(gate(gates, 'DB + Redis + Vector').pass).toBe(false);
        expect(gate(gates, 'DB + Redis + Vector').detail).toMatch(/unexpected schema/);
    });
});

describe('launch-readiness gate — DLQ counters never coerce', () => {
    test('missing autoReplyDlq fails (regression: `dlq=n/a` used to PASS)', () => {
        const body = healthyDetailed();
        delete body.autoReplyDlq;
        const g = gate(run({ detailed: ok(body) }), 'Auto-reply DLQ');
        expect(g.pass).toBe(false);
        expect(g.detail).toMatch(/unverified/);
    });

    test('autoReplyDlq = null fails', () => {
        const g = gate(run({ detailed: ok(healthyDetailed({ autoReplyDlq: null })) }), 'Auto-reply DLQ');
        expect(g.pass).toBe(false);
    });

    test('autoReplyDlq = "0" (string) fails — the schema requires an integer', () => {
        const g = gate(run({ detailed: ok(healthyDetailed({ autoReplyDlq: '0' })) }), 'Auto-reply DLQ');
        expect(g.pass).toBe(false);
    });

    test('autoReplyDlq > 0 fails', () => {
        const g = gate(run({ detailed: ok(healthyDetailed({ autoReplyDlq: 3 })) }), 'Auto-reply DLQ');
        expect(g.pass).toBe(false);
        expect(g.detail).toBe('dlq=3');
    });

    test('inbound webhook dead letters > 0 fails', () => {
        const g = gate(
            run({ detailed: ok(healthyDetailed({ webhookReceipts: { deadLettered: 2, held: 5 } })) }),
            'Inbound webhook DLQ',
        );
        expect(g.pass).toBe(false);
        expect(g.detail).toMatch(/deadLettered=2/);
    });

    test('a missing webhookReceipts block fails', () => {
        const body = healthyDetailed();
        delete body.webhookReceipts;
        const g = gate(run({ detailed: ok(body) }), 'Inbound webhook DLQ');
        expect(g.pass).toBe(false);
        expect(g.detail).toMatch(/unverified/);
    });
});

describe('launch-readiness gate — canary', () => {
    test('missing canary heartbeat fails', () => {
        const g = gate(
            run({ detailed: ok(healthyDetailed({ autoReplyCanary: { lastOkAgeMs: null, fresh: false } })) }),
            'Auto-reply canary',
        );
        expect(g.pass).toBe(false);
        expect(g.detail).toMatch(/no canary heartbeat/);
    });

    test('stale canary heartbeat fails', () => {
        const g = gate(
            run({ detailed: ok(healthyDetailed({ autoReplyCanary: { lastOkAgeMs: 3_600_000, fresh: false } })) }),
            'Auto-reply canary',
        );
        expect(g.pass).toBe(false);
        expect(g.detail).toMatch(/STALE/);
    });

    test('an absent canary block fails', () => {
        const body = healthyDetailed();
        delete body.autoReplyCanary;
        expect(gate(run({ detailed: ok(body) }), 'Auto-reply canary').pass).toBe(false);
    });
});

describe('launch-readiness gate — activation', () => {
    test('401 on the activation endpoint reports unverified, never PASS', () => {
        const g = gate(run({ growth: fail(401) }), 'Activation');
        expect(g.pass).toBe(false);
        expect(g.detail).toMatch(/unverified/);
        expect(g.detail).toMatch(/admin token required/);
    });

    test('below target fails', () => {
        expect(gate(run({ growth: ok(healthyGrowth(4)) }), 'Activation').pass).toBe(false);
    });

    test('an unexpected growth schema fails instead of counting zero', () => {
        const g = gate(run({ growth: ok({ data: {} }) }), 'Activation');
        expect(g.pass).toBe(false);
        expect(g.detail).toMatch(/unexpected schema/);
    });
});
