'use strict';

/**
 * Environment for the backend integration suite.
 *
 * Loaded through jest `setupFiles`, i.e. BEFORE any application module reads
 * process.env at require time, and — deliberately — before any model,
 * migration or fixture module is required. The database guard below therefore
 * runs ahead of the first destructive statement, not after it.
 *
 * Anything already set in the environment wins, which is how CI points the
 * suite at its service containers.
 */

const { assertDisposableDatabase } = require('../helpers/disposable-database');

const def = (key, value) => {
    if (!process.env[key]) process.env[key] = value;
};

process.env.NODE_ENV = 'test';

// ── Infrastructure ───────────────────────────────────────────────────────────
// A DEDICATED database name, so the suite can never truncate a dev catalog.
def('DATABASE_URL', 'postgres://e2e:e2e@127.0.0.1:5432/easymod_e2e');
def('DB_SSL', 'false');
def('REDIS_URL', 'redis://127.0.0.1:6379');
def('GROWTH_OS_ENABLED', 'true');

// ── Crypto / auth ────────────────────────────────────────────────────────────
// Test-only values. Nothing here unlocks anything outside this process.
def('CHANNEL_ENCRYPTION_KEY', 'a'.repeat(64));
def('PAYMENT_ENCRYPTION_KEY', 'b'.repeat(64));
def('DELIVERY_ENCRYPTION_KEY', 'c'.repeat(64));
def('JWT_ACCESS_SECRET', 'integration-jwt-access-secret-at-least-32');
def('JWT_REFRESH_SECRET', 'integration-jwt-refresh-secret-at-least-32');
def('SESSION_SECRET', 'integration-session-secret-at-least-32-chars');
def('AI_ACTION_GATE_SECRET', 'integration-action-gate-secret-at-least-32-chars');

// ── Noise suppression ────────────────────────────────────────────────────────
delete process.env.SLACK_ALERT_WEBHOOK_URL;
delete process.env.SENTRY_DSN;
delete process.env.QDRANT_URL;

// Last: refuse to continue if DATABASE_URL does not name a disposable database.
assertDisposableDatabase(process.env.DATABASE_URL, 'the integration suite');
