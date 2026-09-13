'use strict';

/**
 * ADR M-004: additive columns on the (currently dead) user_sessions table so
 * native per-device sessions can store a rotating refresh token and detect
 * reuse of an already-rotated token. Both columns are nullable/defaulted, so
 * this is purely additive for the existing (empty, uncalled) table — see
 * session.entity.js for why a hash + generation counter is sufficient
 * without a second historical-token table.
 */
module.exports = {
    name: '20260914_001_native_session_refresh_lineage',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE user_sessions
                ADD COLUMN IF NOT EXISTS refresh_token_hash VARCHAR(255);
        `);
        await sequelize.query(`
            ALTER TABLE user_sessions
                ADD COLUMN IF NOT EXISTS refresh_token_generation INTEGER NOT NULL DEFAULT 0;
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token_hash
                ON user_sessions(refresh_token_hash);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP INDEX IF EXISTS idx_user_sessions_refresh_token_hash;');
        await sequelize.query('ALTER TABLE user_sessions DROP COLUMN IF EXISTS refresh_token_generation;');
        await sequelize.query('ALTER TABLE user_sessions DROP COLUMN IF EXISTS refresh_token_hash;');
    },
};
