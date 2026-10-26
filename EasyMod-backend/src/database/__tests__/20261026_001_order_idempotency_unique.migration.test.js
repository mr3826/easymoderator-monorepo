'use strict';

const migration = require('../migrations/20261026_001_order_idempotency_unique');

const makeSequelize = ({ canonicalExists = true, duplicateRows = [] } = {}) => {
    const queries = [];
    return {
        sequelize: {
            query: jest.fn(async (sql) => {
                queries.push(sql);
                if (/FROM pg_indexes/.test(sql)) {
                    return [canonicalExists ? [1] : [], { rowCount: canonicalExists ? 1 : 0 }];
                }
                if (/HAVING COUNT\(\*\) > 1/.test(sql)) {
                    return [duplicateRows, { rowCount: duplicateRows.length }];
                }
                return [[], { rowCount: 0 }];
            }),
        },
        queries,
    };
};

describe('20261026_001_order_idempotency_unique (reconciled)', () => {
    it('drops the redundant draft index and leaves the canonical June index alone', async () => {
        const { sequelize, queries } = makeSequelize({ canonicalExists: true });

        await migration.up(sequelize);

        expect(migration.name).toBe('20261026_001_order_idempotency_unique');
        const sql = queries.join('\n');
        expect(sql).toMatch(/DROP INDEX IF EXISTS idx_orders_shop_idempotency_unique/);
        expect(sql).toMatch(/FROM pg_indexes/);
        expect(sql).not.toMatch(/CREATE UNIQUE INDEX/);
        expect(sql).not.toMatch(/HAVING COUNT\(\*\) > 1/);
    });

    it('recreates the canonical index when absent, after checking for duplicates', async () => {
        const { sequelize, queries } = makeSequelize({ canonicalExists: false });

        await migration.up(sequelize);

        const sql = queries.join('\n');
        expect(sql).toMatch(/GROUP BY shop_id, idempotency_key/);
        expect(sql).toMatch(/HAVING COUNT\(\*\) > 1/);
        expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_idempotency\b/);
        expect(sql).toMatch(/ON orders\(shop_id, idempotency_key\)/);
        expect(sql).toMatch(/WHERE idempotency_key IS NOT NULL/);
    });

    it('refuses to enforce over pre-existing duplicates', async () => {
        const { sequelize, queries } = makeSequelize({
            canonicalExists: false,
            duplicateRows: [{ shop_id: 'shop-1', idempotency_key: 'dup', occurrences: '2' }],
        });

        await expect(migration.up(sequelize)).rejects.toThrow(/duplicated \(shop_id, idempotency_key\) rows exist/);
        expect(queries.join('\n')).not.toMatch(/CREATE UNIQUE INDEX/);
    });

    it('down reverses only this migration artifact, never the June index', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.down(sequelize);

        expect(queries.join('\n')).toBe('DROP INDEX IF EXISTS idx_orders_shop_idempotency_unique;');
    });
});
