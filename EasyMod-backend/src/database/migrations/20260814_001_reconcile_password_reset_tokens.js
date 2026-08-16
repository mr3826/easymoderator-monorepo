'use strict';

/**
 * Reconcile the squashed password_reset_tokens table with the active entity.
 *
 * The initial schema required the legacy plaintext `token` column. The active
 * service writes only `token_hash` and `used_at`, so that NOT NULL constraint
 * made password-reset creation fail on a fresh database. Keep the legacy
 * columns for backward compatibility, but make them optional for new rows.
 */
module.exports = {
    name: '20260814_001_reconcile_password_reset_tokens',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE password_reset_tokens
                ALTER COLUMN token DROP NOT NULL;
        `);
        await sequelize.query(`
            ALTER TABLE password_reset_tokens
                ALTER COLUMN used SET DEFAULT FALSE;
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_prt_active_hash_expiry
                ON password_reset_tokens(token_hash, expires_at)
                WHERE used_at IS NULL;
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP INDEX IF EXISTS idx_prt_active_hash_expiry;');
        // Do not restore NOT NULL: rows created by the active entity do not
        // contain the retired plaintext token column.
    },
};
