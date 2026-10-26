'use strict';

const migration = require('../migrations/20261026_001_order_idempotency_unique');

const makeSequelize = (duplicateRows = []) => {
    const queries = [];
    return {
        sequelize: {
            query: jest.fn(async (sql) => {
                queries.push(sql);
                if (/HAVING COUNT\(\*\) > 1/.test(sql)) return [duplicateRows, { rowCount: duplicateRows.length }];
                return [[], { rowCount: 0 }];
            }),
        },
        queries,
    };
};

describe('20261026_001_order_idempotency_unique', () => {
    it('adds the shop-scoped partial unique index on orders idempotency keys', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.up(sequelize);

        const sql = queries.join('\n');
        expect(migration.name).toBe('20261026_001_order_idempotency_unique');
        expect(sql).toMatch(/GROUP BY shop_id, idempotency_key/);
        expect(sql).toMatch(/HAVING COUNT\(\*\) > 1/);
        expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_idempotency_unique/);
        expect(sql).toMatch(/ON orders\(shop_id, idempotency_key\)/);
        expect(sql).toMatch(/WHERE idempotency_key IS NOT NULL/);
    });

    it('refuses to enforce over pre-existing duplicates', async () => {
        const { sequelize, queries } = makeSequelize([
            { shop_id: 'shop-1', idempotency_key: 'dup', occurrences: '2' },
        ]);

        await expect(migration.up(sequelize)).rejects.toThrow(/duplicated \(shop_id, idempotency_key\) rows exist/);
        expect(queries.join('\n')).not.toMatch(/CREATE UNIQUE INDEX/);
    });

    it('down drops exactly the index up created', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.down(sequelize);

        expect(queries.join('\n')).toBe('DROP INDEX IF EXISTS idx_orders_shop_idempotency_unique;');
    });
});
