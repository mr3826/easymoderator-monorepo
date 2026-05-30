'use strict';

/**
 * Migration: 20260530_019_create_referrals
 *
 * Phase 2.2 — invite-a-shop acquisition loop.
 *
 * Creates the `referrals` table that records one shop inviting another. One row
 * per referred shop (UNIQUE referred_shop_id → idempotent, no double-reward).
 * The referral CODE is the referrer shop's existing unique_code.
 *
 * On the WIPE deploy path this table is also created by `npm run db:sync` from
 * the Sequelize model; this migration makes a normal (non-destructive) deploy
 * create it too. Idempotent via CREATE TABLE / INDEX IF NOT EXISTS.
 *
 * Mirrors EasyMod-backend/src/modules/referral/referral.entity.js.
 */

module.exports = {
    name: '20260530_019_create_referrals',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS referrals (
                id                UUID PRIMARY KEY,
                referrer_shop_id  UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                referred_shop_id  UUID NOT NULL UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
                referred_user_id  UUID NULL,
                code              VARCHAR(20) NOT NULL,
                status            VARCHAR(255) NOT NULL DEFAULT 'rewarded',
                referrer_reward   INTEGER NOT NULL DEFAULT 0,
                referred_reward   INTEGER NOT NULL DEFAULT 0,
                rewarded_at       TIMESTAMPTZ NULL,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        console.log('[migration 019] Created table: referrals');

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS referrals_referrer_shop_id
            ON referrals(referrer_shop_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS referrals_code
            ON referrals(code);
        `);
        console.log('[migration 019] Created indexes: referrer_shop_id, code');

        console.log('[migration] 20260530_019_create_referrals: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP TABLE IF EXISTS referrals;`);
        console.log('[migration] 20260530_019_create_referrals: DOWN complete');
    }
};
