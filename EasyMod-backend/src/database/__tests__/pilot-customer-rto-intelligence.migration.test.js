'use strict';

const migration = require('../migrations/20260927_001_pilot_customer_rto_intelligence');

const run = async (method) => {
    const statements = [];
    await migration[method]({
        getDialect: () => 'postgres',
        query: async (sql) => { statements.push(sql); return [[]]; },
    });
    return statements.join('\n');
};

describe('20260927_001_pilot_customer_rto_intelligence', () => {
    test('exports the custom-runner migration contract', () => {
        expect(migration.name).toBe('20260927_001_pilot_customer_rto_intelligence');
        expect(typeof migration.up).toBe('function');
        expect(typeof migration.down).toBe('function');
    });

    test('is additive and idempotent', async () => {
        const sql = await run('up');
        // No change to existing columns or data (FK "ON DELETE …" clauses are fine).
        expect(sql).not.toMatch(/ALTER TABLE|\bDROP\s|\bUPDATE\s+\w+\s+SET\b|DELETE\s+FROM/i);
        for (const statement of sql.split(/;\s*\n/).filter((s) => /CREATE/.test(s))) {
            expect(statement).toMatch(/IF NOT EXISTS/);
        }
    });

    test('platform flags default off and constrain the mode', async () => {
        const sql = await run('up');
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS shop_pilot_features/);
        expect(sql).toMatch(/customer_intelligence\s+BOOLEAN NOT NULL DEFAULT FALSE/);
        expect(sql).toMatch(/order_confidence_mode\s+VARCHAR\(10\) NOT NULL DEFAULT 'off'/);
        expect(sql).toMatch(/CHECK \(order_confidence_mode IN \('off', 'shadow', 'enforce'\)\)/);
    });

    test('enforces one live opportunity per customer in the database', async () => {
        expect(await run('up')).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_opportunities_live\s+ON customer_opportunities\(shop_id, customer_id\)\s+WHERE status IN \('OPEN', 'ACTIONED'\)/,
        );
    });

    test('keeps one confidence row per order with a CAS version and outcome', async () => {
        const sql = await run('up');
        expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_order_confidence_order\s+ON order_confidence\(order_id\)/);
        for (const column of ['version', 'input_fingerprint', 'resolution_fingerprint', 'resolution_level', 'outcome', 'released_decision']) {
            expect(sql).toContain(column);
        }
        expect(sql).toMatch(/CHECK \(decision IN \('READY', 'VERIFY', 'MANUAL_REVIEW'\)\)/);
    });

    test('tenant keys cascade from shops, and customer deletion cannot orphan an opportunity', async () => {
        const sql = await run('up');
        expect(sql.match(/shop_id\s+UUID (?:NOT NULL |PRIMARY KEY )?REFERENCES shops\(id\) ON DELETE CASCADE/g)).toHaveLength(3);
        expect(sql).toMatch(/customer_id\s+UUID NOT NULL REFERENCES customers\(id\) ON DELETE CASCADE/);
    });

    test('down removes exactly what up created', async () => {
        const sql = await run('down');
        expect(sql).toContain('DROP INDEX IF EXISTS idx_orders_shop_customer_phone');
        for (const table of ['order_confidence', 'customer_opportunities', 'shop_pilot_features']) {
            expect(sql).toContain(`DROP TABLE IF EXISTS ${table} CASCADE`);
        }
        expect(sql).not.toMatch(/DROP TABLE IF EXISTS (orders|customers|shops)\b/);
    });
});
