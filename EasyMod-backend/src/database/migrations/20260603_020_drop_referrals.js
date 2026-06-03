'use strict';

/**
 * Migration: 20260603_020_drop_referrals
 *
 * Removes the invite-and-earn (referral) feature. Drops the `referrals` table
 * that was created by 20260530_019_create_referrals (that create migration and
 * the Referral entity/module have been deleted).
 *
 * Dialect-aware and idempotent: `DROP TABLE IF EXISTS` is a safe no-op where the
 * table never existed (db:sync dev environments, since the entity is gone), and
 * drops it on migrate-up (Postgres prod) deployments.
 *
 * Irreversible by design: any existing referral rows are permanently deleted and
 * `down` is intentionally a no-op — the feature is not being reintroduced.
 */
module.exports = {
    name: '20260603_020_drop_referrals',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();

        if (dialect === 'postgres') {
            await sequelize.query(`DROP TABLE IF EXISTS referrals CASCADE;`);
        } else {
            await sequelize.query(`DROP TABLE IF EXISTS referrals;`);
        }
    },

    down: async () => {
        // Intentionally irreversible — the invite-and-earn feature has been removed.
    }
};
