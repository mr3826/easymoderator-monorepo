'use strict';

/**
 * 20260814_001 against BOTH password_reset_tokens lineages, on a real Postgres.
 *
 * The production run of this migration failed while CI stayed green: CI always
 * builds a fresh squash-shaped database, production still carries the
 * pre-squash shape (archive/20260408_001) because its ledger marks the squash
 * executed. Mocked migration unit tests cannot see that difference — only a
 * real database with the other shape can.
 *
 * The fixtures drop the foreign key to users on purpose: what is under test is
 * which columns an entity-shaped INSERT is allowed to omit, not referential
 * integrity.
 */

const { sequelize } = require('../../utils/database/database-setup');
const migration = require('../migrations/20260814_001_reconcile_password_reset_tokens');

// Production, built by archive/20260408_001: hash-only, no token, no used.
const PRE_SQUASH_SHAPE = `
    CREATE TABLE password_reset_tokens (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL,
        token_hash  VARCHAR(64) NOT NULL UNIQUE,
        expires_at  TIMESTAMPTZ NOT NULL,
        used_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`;

// Fresh/CI, built by 20260520_000 before 20260522_003 adds the entity columns.
const SQUASH_SHAPE = `
    CREATE TABLE password_reset_tokens (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL,
        token       TEXT NOT NULL UNIQUE,
        expires_at  TIMESTAMPTZ NOT NULL,
        used        BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`;

const applyShape = async (shape) => {
    await sequelize.query('DROP TABLE IF EXISTS password_reset_tokens CASCADE;');
    await sequelize.query(shape);
};

// What password-reset creation actually issues: no token, no used.
const insertEntityShapedRow = (hash) => sequelize.query(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (gen_random_uuid(), '${hash}', NOW() + INTERVAL '1 hour');
`);

const columns = async () => {
    const [rows] = await sequelize.query(`
        SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'password_reset_tokens';
    `);
    return Object.fromEntries(rows.map((r) => [r.column_name, r]));
};

const indexExists = async () => {
    const [rows] = await sequelize.query(`
        SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'idx_prt_active_hash_expiry';
    `);
    return rows.length === 1;
};

describe('20260814_001 reconcile password_reset_tokens', () => {
    afterAll(async () => {
        // Leave the suite database in the shape the migration chain produces.
        await applyShape(SQUASH_SHAPE);
        await migration.up(sequelize);
    });

    it('applies to the pre-squash production shape, which has no token/used columns', async () => {
        await applyShape(PRE_SQUASH_SHAPE);

        await expect(migration.up(sequelize)).resolves.not.toThrow();

        expect(await indexExists()).toBe(true);
        await expect(insertEntityShapedRow('a'.repeat(64))).resolves.toBeDefined();
    });

    it('relaxes the squash shape so an entity INSERT can omit token and used', async () => {
        await applyShape(SQUASH_SHAPE);

        await migration.up(sequelize);

        const cols = await columns();
        expect(cols.token.is_nullable).toBe('YES');
        expect(cols.used.column_default).toMatch(/false/);
        // 20260522_003 is skipped on any database whose ledger already claims
        // it; the migration must add the entity columns the index needs.
        expect(cols.token_hash).toBeDefined();
        expect(cols.used_at).toBeDefined();
        expect(await indexExists()).toBe(true);

        await expect(insertEntityShapedRow('b'.repeat(64))).resolves.toBeDefined();
    });

    it('is re-runnable: the runner does not wrap migrations in a transaction', async () => {
        await applyShape(PRE_SQUASH_SHAPE);

        await migration.up(sequelize);
        await expect(migration.up(sequelize)).resolves.not.toThrow();
    });
});
