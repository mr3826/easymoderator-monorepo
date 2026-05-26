'use strict';

/**
 * Migration: 20260527_018_drop_legacy_meta_channels_unique_constraints
 *
 * Completes the constraint cleanup that migration 012
 * (20260522_012_meta_channels_multi_page_indexes) intended but missed.
 *
 * Migration 012 issued `DROP INDEX IF EXISTS unique_meta_channel_shop_platform`
 * and `DROP INDEX IF EXISTS unique_meta_channel_asset_id` — those names match
 * what we would have created via a `CREATE INDEX name ...` migration. But the
 * original meta_channels table was created via Sequelize sync (the entity
 * declared `unique: true` on the fields), which generated UNIQUE CONSTRAINTS
 * under PostgreSQL's auto-generated names: `meta_channels_shop_id_platform_key`
 * and `meta_channels_meta_asset_id_key`. The `DROP INDEX IF EXISTS` calls were
 * therefore no-ops in production and the legacy constraints stuck around,
 * silently rejecting Phase-1 multi-page connects with a generic
 * "Validation error" 500.
 *
 * This migration drops them under their real constraint names. Idempotent
 * (uses IF EXISTS), so re-running is a no-op.
 *
 * Cross-shop ownership of the same Meta asset is still enforced at the
 * application layer in MetaChannelService.upsertFromOAuth.
 */

module.exports = {
    name: '20260527_018_drop_legacy_meta_channels_unique_constraints',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_channels
            DROP CONSTRAINT IF EXISTS meta_channels_shop_id_platform_key;
        `);
        console.log('[migration 018] Dropped constraint meta_channels_shop_id_platform_key (if existed).');

        await sequelize.query(`
            ALTER TABLE meta_channels
            DROP CONSTRAINT IF EXISTS meta_channels_meta_asset_id_key;
        `);
        console.log('[migration 018] Dropped constraint meta_channels_meta_asset_id_key (if existed).');

        console.log('[migration] 20260527_018_drop_legacy_meta_channels_unique_constraints: UP complete');
    },

    down: async (sequelize) => {
        // Re-creating these would re-introduce the Phase-1 bug. Block rollback
        // if any shop has multiple channels of the same platform OR if any
        // meta_asset_id is owned by more than one shop.
        const [platformDupes] = await sequelize.query(`
            SELECT shop_id, platform, COUNT(*) AS n
            FROM meta_channels
            GROUP BY shop_id, platform
            HAVING COUNT(*) > 1;
        `);
        if (platformDupes.length > 0) {
            console.error('[migration 018 DOWN] Cannot recreate (shop_id, platform) unique — duplicates exist:', platformDupes);
            throw new Error('Rollback blocked: shops have multiple channels of the same platform.');
        }
        const [assetDupes] = await sequelize.query(`
            SELECT meta_asset_id, COUNT(*) AS n
            FROM meta_channels
            GROUP BY meta_asset_id
            HAVING COUNT(*) > 1;
        `);
        if (assetDupes.length > 0) {
            console.error('[migration 018 DOWN] Cannot recreate UNIQUE(meta_asset_id) — duplicates exist:', assetDupes);
            throw new Error('Rollback blocked: meta_asset_id is shared across shops.');
        }

        await sequelize.query(`
            ALTER TABLE meta_channels
            ADD CONSTRAINT meta_channels_shop_id_platform_key UNIQUE (shop_id, platform);
        `);
        await sequelize.query(`
            ALTER TABLE meta_channels
            ADD CONSTRAINT meta_channels_meta_asset_id_key UNIQUE (meta_asset_id);
        `);
        console.log('[migration] 20260527_018_drop_legacy_meta_channels_unique_constraints: DOWN complete');
    },
};
