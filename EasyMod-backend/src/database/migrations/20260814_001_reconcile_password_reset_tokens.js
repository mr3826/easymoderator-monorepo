'use strict';

/**
 * Reconcile password_reset_tokens with the active entity, on EITHER lineage.
 *
 * The entity writes only user_id/token_hash/expires_at/used_at/created_at. Two
 * different table shapes exist in the wild and the first cut of this migration
 * only handled one of them:
 *
 *   squash lineage (20260520_000, i.e. every fresh/CI database)
 *       token TEXT NOT NULL UNIQUE, used BOOLEAN NOT NULL — the NOT NULL on the
 *       retired plaintext column made password-reset creation fail; token_hash
 *       and used_at arrive later, from 20260522_003.
 *
 *   pre-squash lineage (archive/20260408_001, i.e. production)
 *       token_hash NOT NULL UNIQUE, used_at — and NO token, NO used columns.
 *
 * Production's migrations ledger marks every pre-20260726 migration executed
 * (see 20260816_001), so the squash never ran there and never will. Bare
 * `ALTER COLUMN token DROP NOT NULL` therefore aborted the production run with
 * `column "token" of relation "password_reset_tokens" does not exist`, while
 * CI — always a fresh squash-shaped database — stayed green.
 *
 * Every statement below is guarded on what the target actually has, so the
 * migration converges both lineages and is safe to re-run (the runner does not
 * wrap migrations in a transaction).
 */
module.exports = {
    name: '20260814_001_reconcile_password_reset_tokens',

    up: async (sequelize) => {
        if (sequelize.getDialect() !== 'postgres') return;

        // Legacy squash columns: present only on the squash lineage. Relax them
        // so an entity INSERT that omits both succeeds; keep them for rows that
        // predate the hash-only service.
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = current_schema()
                             AND table_name = 'password_reset_tokens' AND column_name = 'token') THEN
                    ALTER TABLE password_reset_tokens ALTER COLUMN token DROP NOT NULL;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = current_schema()
                             AND table_name = 'password_reset_tokens' AND column_name = 'used') THEN
                    ALTER TABLE password_reset_tokens ALTER COLUMN used SET DEFAULT FALSE;
                END IF;
            END $$;
        `);

        // Entity columns: present on the pre-squash lineage, and on the squash
        // lineage only once 20260522_003 has run. Add them where the ledger
        // skipped it, so the index below and the entity both have their columns.
        await sequelize.query(`ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);`);
        await sequelize.query(`ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;`);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_prt_active_hash_expiry
                ON password_reset_tokens(token_hash, expires_at)
                WHERE used_at IS NULL;
        `);
    },

    down: async (sequelize) => {
        if (sequelize.getDialect() !== 'postgres') return;
        await sequelize.query('DROP INDEX IF EXISTS idx_prt_active_hash_expiry;');
        // Do not restore NOT NULL and do not drop token_hash/used_at: rows
        // created by the active entity carry no plaintext token, and the
        // pre-squash lineage stores its only usable token in token_hash.
    },
};
