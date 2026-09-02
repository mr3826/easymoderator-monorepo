'use strict';

const migration = require('../migrations/20260902_001_business_ai_reply_mode');

const makeSequelize = () => {
    const queries = [];
    return {
        sequelize: {
            query: jest.fn(async (sql) => {
                queries.push(sql);
                return [[], { rowCount: 0 }];
            }),
        },
        queries,
    };
};

describe('20260902_001_business_ai_reply_mode', () => {
    it('exports the migration runner contract', () => {
        expect(migration.name).toBe('20260902_001_business_ai_reply_mode');
        expect(typeof migration.up).toBe('function');
        expect(typeof migration.down).toBe('function');
    });

    it('normalizes business modes without replacing malformed JSON values', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.up(sequelize);

        const sql = queries.join('\n');
        expect(sql).toMatch(/UPDATE shops/);
        expect(sql).toMatch(/jsonb_set/);
        expect(sql).toMatch(/jsonb_typeof\(settings::jsonb\) = 'object'/);
        expect(sql).toMatch(/COALESCE\(settings::jsonb, '\{\}'::jsonb\)/);
        expect(sql).toMatch(/'AI_ACTIVE' THEN 'AUTO'/);
        expect(sql).toMatch(/'AI_SUGGEST_ONLY' THEN 'DRAFT'/);
        expect(sql).toMatch(/'HUMAN_ACTIVE' THEN 'MANUAL'/);
        expect(sql).toMatch(/NOT IN \('AUTO', 'DRAFT', 'MANUAL'\)/);
        expect(sql).toMatch(/btrim\(settings #>> '\{ai,automation_mode\}'\)/);
        expect(sql).toMatch(/settings IS NULL/);
        expect(sql).toMatch(/SET DEFAULT 'MANUAL'/);
        expect(sql).toMatch(/COMMENT ON COLUMN meta_channel_settings\.automation_mode/);
        expect(sql).toMatch(/COMMENT ON COLUMN meta_channel_settings\.ai_auto_reply/);
        expect(sql).not.toMatch(/DROP COLUMN|DROP TYPE|DELETE FROM|TRUNCATE/);
    });

    it('only restores the prior Page default on rollback', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.down(sequelize);

        expect(queries).toHaveLength(1);
        expect(queries[0]).toMatch(/ALTER COLUMN automation_mode SET DEFAULT 'DRAFT'/);
        expect(queries[0]).not.toMatch(/UPDATE|COMMENT ON|DROP COLUMN|DROP TYPE/);
    });
});
