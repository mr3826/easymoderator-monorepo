'use strict';

/**
 * 20260610_001_drop_legacy_channel_tables
 *
 * Phase 5 cutover — removes the legacy storage layer now that meta_channels
 * is the single source of truth.
 *
 * Drops (in dependency order):
 *   1. customers.marketing_opt_out column (replaced by messaging_consent JSONB)
 *   2. channel_configs table (CASCADE — removes any FK children)
 *   3. meta_integrations table (CASCADE — removes any FK children)
 *
 * No data-parity check needed: no real user data exists.
 * Migration is transactional: all three operations commit together or not at all.
 *
 * DOWN is intentionally blocked — this is a destructive cutover.
 * Restore from a pre-cutover DB backup if rollback is required.
 */

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            // 1. Drop the global opt-out column (per-channel consent lives in messaging_consent JSONB)
            await queryInterface.removeColumn('customers', 'marketing_opt_out', { transaction: t });

            // 2. Drop legacy channel_configs table (created by pre-redesign channel module)
            await queryInterface.dropTable('channel_configs', { transaction: t, cascade: true });

            // 3. Drop legacy meta_integrations table (split-brain with channel_configs — now gone)
            await queryInterface.dropTable('meta_integrations', { transaction: t, cascade: true });
        });
    },

    async down() {
        throw new Error(
            'Phase 5 cutover is irreversible. Restore from a pre-cutover DB backup if rollback is required.'
        );
    },
};
