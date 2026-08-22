'use strict';

const migration = require('../migrations/20260823_002_reconcile_legacy_entity_drift');

const run = async (method) => {
    const statements = [];
    await migration[method]({ query: async (sql) => { statements.push(sql); return [[]]; } });
    return statements.join('\n');
};

describe('20260823_002_reconcile_legacy_entity_drift', () => {
    test('exports the migration contract and reconciles legacy blocking columns', async () => {
        expect(migration.name).toBe('20260823_002_reconcile_legacy_entity_drift');
        const sql = await run('up');
        expect(sql).toMatch(/payment_configs[\s\S]*credentials TYPE TEXT/);
        expect(sql).toContain('payment_configs ALTER COLUMN provider DROP NOT NULL');
        expect(sql).toContain('product_variants ALTER COLUMN shop_id DROP NOT NULL');
        expect(sql).toContain('product_variants ALTER COLUMN name DROP NOT NULL');
    });

    test('down backfills legacy required fields before restoring constraints', async () => {
        const sql = await run('down');
        expect(sql).toContain('SET provider = COALESCE(provider, gateway,');
        expect(sql).toContain('SET shop_id = p.shop_id');
        expect(sql).toContain('ALTER COLUMN shop_id SET NOT NULL');
        expect(sql).toContain('ALTER COLUMN name SET NOT NULL');
    });
});
