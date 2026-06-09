'use strict';

/**
 * Migration: 20260609_001_add_user_platform_role
 *
 * Adds nullable `users.platform_role` for EasyModerator operators.
 * NULL = normal merchant user. Distinct from the tenant user_shops.role
 * (owner/admin/staff). STRING (not ENUM) — values are validated in code
 * (PLATFORM_ROLES: SUPPORT_ADMIN / SUPER_ADMIN) and STRING avoids the
 * ENUM-migration friction this repo has hit before.
 *
 * The User entity (src/modules/user/user.entity.js) declares `platform_role`,
 * so it is SELECTed on every user query — without this column those queries
 * 500 with `column User.platform_role does not exist`. Idempotent.
 */

module.exports = {
    name: '20260609_001_add_user_platform_role',

    up: async (sequelize) => {
        await sequelize.query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role VARCHAR(20);`
        );
        await sequelize.query(
            `CREATE INDEX IF NOT EXISTS users_platform_role_idx ON users (platform_role);`
        );
        console.log('[migration] 20260609_001_add_user_platform_role: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS users_platform_role_idx;`);
        await sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS platform_role;`);
        console.log('[migration] 20260609_001_add_user_platform_role: DOWN complete');
    }
};
