'use strict';

const migration = require('../migrations/20260531_000_pricing_simplification');

describe('20260531_000_pricing_simplification', () => {
    it('keeps the transaction usable when an optional legacy column is absent', async () => {
        const queries = [];
        const sequelize = {
            getDialect: () => 'postgres',
            query: jest.fn(async (sql) => {
                queries.push(sql);
                if (sql.includes('ALTER COLUMN plan_name')) {
                    throw new Error('column plan_name does not exist');
                }
                return [[], { rowCount: 0 }];
            }),
        };

        await migration.up(sequelize);

        expect(queries).toContain('ROLLBACK TO SAVEPOINT pricing_optional_0');
        expect(queries.some((sql) => sql.includes('UPDATE subscriptions'))).toBe(true);
        expect(queries.some((sql) => sql.includes("SET DEFAULT 'trialing'"))).toBe(false);
    });
});
