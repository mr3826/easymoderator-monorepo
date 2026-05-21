'use strict';

/**
 * Migration: 20260522_001_fix_users_schema
 *
 * The squashed initial schema created `users` with columns that diverged from
 * the User entity, so signup failed with `column "full_name" does not exist`.
 *
 * This adds the columns the User model expects, backfills full_name from the
 * legacy `name` column when present, and is safe to run on any existing DB.
 */

module.exports = {
    name: '20260522_001_fix_users_schema',

    up: async (sequelize) => {
        await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT;`);
        await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT;`);
        await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_logged_shop_id UUID REFERENCES shops(id) ON DELETE SET NULL;`);

        // Backfill full_name from legacy `name` column if it still exists.
        await sequelize.query(`
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'name'
                ) THEN
                    EXECUTE 'UPDATE users SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL';
                END IF;
            END $$;
        `);

        // token_version default in the model is 1; align existing rows that came in as 0.
        await sequelize.query(`UPDATE users SET token_version = 1 WHERE token_version = 0;`);
        await sequelize.query(`ALTER TABLE users ALTER COLUMN token_version SET DEFAULT 1;`);

        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_users_last_shop ON users(last_logged_shop_id);`);

        console.log('[migration] 20260522_001_fix_users_schema: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS idx_users_last_shop;`);
        await sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS last_logged_shop_id;`);
        await sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS refresh_token;`);
        await sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS profile_picture;`);
        await sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS phone;`);
        await sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS full_name;`);
        await sequelize.query(`ALTER TABLE users ALTER COLUMN token_version SET DEFAULT 0;`);

        console.log('[migration] 20260522_001_fix_users_schema: DOWN complete');
    }
};
