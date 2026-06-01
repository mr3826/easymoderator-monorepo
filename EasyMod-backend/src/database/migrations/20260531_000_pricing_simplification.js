'use strict';

/**
 * Migration: 20260531_000_pricing_simplification
 *
 * Collapses the legacy Free / Package 1 / Package 2 tiers into the single
 * GROWTH plan (৳999 / 300 conversations + 50 grace buffer). The 14-day trial is
 * a `status` value, not a plan.
 *
 * Notes:
 *  - subscriptions.status is VARCHAR(50) (NOT a native pg enum), so the new
 *    `trialing` / `trial_expired` values need no DDL — only the Sequelize model
 *    enum list (subscription.entity.js) had to learn them.
 *  - Idempotent and dialect-aware (Postgres prod / SQLite dev). Each ALTER is
 *    wrapped so a minimal schema missing a column never aborts the run.
 */
module.exports = {
    name: '20260531_000_pricing_simplification',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();

        // 1. Column defaults → GROWTH (Postgres only; the app always sets these
        //    explicitly on create, but keep fresh-install defaults correct).
        if (dialect === 'postgres') {
            const alters = [
                `ALTER TABLE subscriptions ALTER COLUMN plan_name SET DEFAULT 'Growth'`,
                `ALTER TABLE subscriptions ALTER COLUMN plan_code SET DEFAULT 'GROWTH'`,
                `ALTER TABLE subscriptions ALTER COLUMN plan_price SET DEFAULT 999`,
                `ALTER TABLE subscriptions ALTER COLUMN conversations_limit SET DEFAULT 300`,
                `ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'trialing'`
            ];
            for (const sql of alters) {
                try { await sequelize.query(sql); } catch (_) { /* column absent on minimal schema */ }
            }
        }

        // 2. Data backfill — collapse every legacy / non-partner plan to GROWTH.
        //    PARTNER rows are intentionally left untouched. Case-insensitive so
        //    it works regardless of how legacy codes were stored.
        await sequelize.query(`
            UPDATE subscriptions
               SET plan_code = 'GROWTH',
                   plan_name = 'Growth',
                   plan_price = 999,
                   conversations_limit = 300
             WHERE plan_code IS NULL
                OR UPPER(plan_code) IN ('FREE','PACKAGE_1','PACKAGE_2','STARTER','PRO','BUSINESS')
        `);
    },

    down: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect === 'postgres') {
            const reverts = [
                `ALTER TABLE subscriptions ALTER COLUMN plan_name SET DEFAULT 'Package 1'`,
                `ALTER TABLE subscriptions ALTER COLUMN plan_code SET DEFAULT 'PACKAGE_1'`,
                `ALTER TABLE subscriptions ALTER COLUMN plan_price SET DEFAULT 750`,
                `ALTER TABLE subscriptions ALTER COLUMN conversations_limit SET DEFAULT 500`,
                `ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'active'`
            ];
            for (const sql of reverts) {
                try { await sequelize.query(sql); } catch (_) { /* noop */ }
            }
        }
        // The plan-collapse data change is one-way: the legacy tiers no longer
        // exist in code, so there is nothing meaningful to restore rows to.
    }
};
