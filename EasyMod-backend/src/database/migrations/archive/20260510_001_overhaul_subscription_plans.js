'use strict';

/**
 * Migration: Overhaul subscription plans
 *
 * Changes:
 * - Renames STARTER → PACKAGE_1 (750 BDT / 500 conversations/month)
 * - Renames GROWTH  → PACKAGE_2 (1950 BDT / 1500 conversations/month)
 * - Keeps  PARTNER as per-order billing with tiered rates
 * - Adds topup_balance  — extra conversations purchased via top-up
 * - Adds threshold_conversations — +50 emergency buffer when limit hit
 * - Adds threshold_debt — cumulative threshold conversations consumed (deducted next cycle)
 * - Removes channel-count-based limits (all channels open on all plans)
 */

module.exports = {
    name: '20260510_001_overhaul_subscription_plans',

    up: async (sequelize) => {
        // Add topup_balance column
        await sequelize.query(`
            ALTER TABLE subscriptions
            ADD COLUMN IF NOT EXISTS topup_balance INTEGER NOT NULL DEFAULT 0
        `).catch(() =>
            sequelize.query(`ALTER TABLE subscriptions ADD COLUMN topup_balance INTEGER NOT NULL DEFAULT 0`).catch(() => {})
        );

        // Add threshold_conversations column (current active threshold buffer)
        await sequelize.query(`
            ALTER TABLE subscriptions
            ADD COLUMN IF NOT EXISTS threshold_conversations INTEGER NOT NULL DEFAULT 0
        `).catch(() =>
            sequelize.query(`ALTER TABLE subscriptions ADD COLUMN threshold_conversations INTEGER NOT NULL DEFAULT 0`).catch(() => {})
        );

        // Add threshold_debt column (cumulative debt to deduct from next cycle)
        await sequelize.query(`
            ALTER TABLE subscriptions
            ADD COLUMN IF NOT EXISTS threshold_debt INTEGER NOT NULL DEFAULT 0
        `).catch(() =>
            sequelize.query(`ALTER TABLE subscriptions ADD COLUMN threshold_debt INTEGER NOT NULL DEFAULT 0`).catch(() => {})
        );

        // Migrate plan codes: STARTER → PACKAGE_1, GROWTH → PACKAGE_2
        await sequelize.query(`
            UPDATE subscriptions
            SET plan_code = 'PACKAGE_1', plan_name = 'Package 1'
            WHERE plan_code IN ('STARTER', 'starter', 'FREE', 'free')
               OR plan_name IN ('Starter', 'Free', 'starter', 'free')
        `);

        await sequelize.query(`
            UPDATE subscriptions
            SET plan_code = 'PACKAGE_2', plan_name = 'Package 2'
            WHERE plan_code IN ('GROWTH', 'growth')
               OR plan_name IN ('Growth', 'growth')
        `);

        // Set conversation limits to match new plans
        await sequelize.query(`
            UPDATE subscriptions
            SET conversations_limit = 500
            WHERE plan_code = 'PACKAGE_1'
        `);

        await sequelize.query(`
            UPDATE subscriptions
            SET conversations_limit = 1500
            WHERE plan_code = 'PACKAGE_2'
        `);

        // PARTNER: unlimited conversations, -1 sentinel
        await sequelize.query(`
            UPDATE subscriptions
            SET conversations_limit = -1
            WHERE plan_code IN ('PARTNER', 'partner')
        `);

        console.log('  ✓ Added topup_balance column');
        console.log('  ✓ Added threshold_conversations column');
        console.log('  ✓ Added threshold_debt column');
        console.log('  ✓ Migrated STARTER → PACKAGE_1 with 500 conv limit');
        console.log('  ✓ Migrated GROWTH  → PACKAGE_2 with 1500 conv limit');
        console.log('  ✓ Set PARTNER conversations_limit = -1 (unlimited)');
    },

    down: async (sequelize) => {
        // Revert plan codes
        await sequelize.query(`
            UPDATE subscriptions SET plan_code = 'STARTER', plan_name = 'Starter'
            WHERE plan_code = 'PACKAGE_1'
        `);
        await sequelize.query(`
            UPDATE subscriptions SET plan_code = 'GROWTH', plan_name = 'Growth'
            WHERE plan_code = 'PACKAGE_2'
        `);

        const dialect = sequelize.getDialect();
        if (dialect === 'postgres') {
            await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS topup_balance`);
            await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS threshold_conversations`);
            await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS threshold_debt`);
        }

        console.log('  ✓ Reverted subscription plan overhaul');
    }
};
