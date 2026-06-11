/**
 * Contract tests for 20260611_003_schema_drift_sweep.
 *
 * The unit suite mocks the database, so prod schema drift is invisible to it —
 * these tests instead pin (a) the custom-runner contract, (b) that the sweep
 * repairs every drift class found by the 2026-06-11 audit, and (c) that the
 * SQL the order service actually runs agrees with the column the migration
 * produces (the drift that broke ALL order creation: counter vs next_number).
 */

const fs = require('fs');
const path = require('path');

const migration = require('../migrations/20260611_003_schema_drift_sweep');

const runUp = async () => {
    const statements = [];
    const fakeSequelize = {
        getDialect: () => 'postgres',
        query: async (sql) => { statements.push(sql); return [[]]; },
    };
    await migration.up(fakeSequelize);
    return statements.join('\n');
};

describe('20260611_003_schema_drift_sweep', () => {
    test('exports the custom-runner contract { name, up, down }', () => {
        expect(migration.name).toBe('20260611_003_schema_drift_sweep');
        expect(typeof migration.up).toBe('function');
        expect(typeof migration.down).toBe('function');
    });

    test('is a no-op on non-postgres dialects', async () => {
        const calls = [];
        await migration.up({ getDialect: () => 'sqlite', query: async (sql) => calls.push(sql) });
        await migration.down({ getDialect: () => 'sqlite', query: async (sql) => calls.push(sql) });
        expect(calls).toHaveLength(0);
    });

    test('renames order_sequences.counter to next_number (guarded)', async () => {
        const sql = await runUp();
        expect(sql).toMatch(/RENAME COLUMN counter TO next_number/);
        expect(sql).toMatch(/column_name = 'next_number'/); // idempotence guard
    });

    test('drops the legacy NOT NULL columns that killed every insert', async () => {
        const sql = await runUp();
        for (const frag of [
            'ALTER TABLE policy_decisions DROP COLUMN IF EXISTS action',
            'ALTER TABLE policy_decisions DROP COLUMN IF EXISTS decision',
            'ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS subscription',
            'ALTER TABLE customer_delivery_stats DROP COLUMN IF EXISTS customer_id',
            'ALTER TABLE courier_cod_collections DROP COLUMN IF EXISTS tracking_id',
            'ALTER TABLE courier_cod_collections DROP COLUMN IF EXISTS expected_amount',
            'ALTER TABLE reconciliation_disputes DROP COLUMN IF EXISTS dispute_type',
            'ALTER TABLE trx_id_logs DROP COLUMN IF EXISTS gateway',
        ]) {
            expect(sql).toContain(frag);
        }
    });

    test('adds the subscription statuses the entity defaults to', async () => {
        const sql = await runUp();
        expect(sql).toMatch(/ADD VALUE IF NOT EXISTS 'trialing'/);
        expect(sql).toMatch(/ADD VALUE IF NOT EXISTS 'trial_expired'/);
        expect(sql).toMatch(/ADD VALUE IF NOT EXISTS 'past_due'/);
    });

    test('recreates the two tables the squash dropped', async () => {
        const sql = await runUp();
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS topup_transactions/);
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS conversation_usage/);
        // recordConversation() upserts ON CONFLICT on exactly this key:
        expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS idx_conv_usage_unique ON conversation_usage\(shop_id, conversation_id, billing_period\)/);
    });

    test('repairs the type drifts (uuid ids, jsonb metadata, nullable amount)', async () => {
        const sql = await runUp();
        expect(sql).toMatch(/ALTER TABLE invoices ALTER COLUMN id TYPE UUID/);
        expect(sql).toMatch(/ALTER TABLE usage_events ALTER COLUMN id TYPE UUID/);
        expect(sql).toMatch(/resource_metadata TYPE JSONB/);
        expect(sql).toMatch(/ALTER TABLE trx_id_logs ALTER COLUMN amount DROP NOT NULL/);
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS resolved_by UUID/);
    });
});

describe('order-number SQL ↔ schema alignment', () => {
    // generateOrderNumber() writes raw SQL, so no entity pins its column names.
    // This guards the exact mismatch that 500'd every manual and chatbot order.
    test('order.service writes the column the sweep migration guarantees', () => {
        const serviceSrc = fs.readFileSync(
            path.join(__dirname, '..', '..', 'modules', 'order', 'order.service.js'), 'utf8');
        expect(serviceSrc).toMatch(/INSERT INTO order_sequences \(shop_id, next_number\)/);
        expect(serviceSrc).not.toMatch(/order_sequences[^\n]*\bcounter\b/);
    });

    test('conversation-limit middleware upsert key matches the unique index', () => {
        const mwSrc = fs.readFileSync(
            path.join(__dirname, '..', '..', 'middleware', 'conversation-limit.middleware.js'), 'utf8');
        expect(mwSrc).toMatch(/ON CONFLICT \(shop_id, conversation_id, billing_period\)/);
    });
});
