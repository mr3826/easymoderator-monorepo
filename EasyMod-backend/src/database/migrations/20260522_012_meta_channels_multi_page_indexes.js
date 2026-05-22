'use strict';

/**
 * Migration: 20260522_012_meta_channels_multi_page_indexes
 *
 * Phase 1 of the multi-channel identity rework. Lifts the "one FB + one IG row
 * per shop" restriction so a single shop can connect multiple Facebook Pages or
 * Instagram accounts. Cross-shop ownership of the same Meta asset is still
 * blocked, but at the application layer (meta-channel.service.js:65-75), not
 * via a global unique index.
 *
 * Changes:
 *   DROP UNIQUE INDEX unique_meta_channel_shop_platform  ON meta_channels(shop_id, platform)
 *   DROP UNIQUE INDEX unique_meta_channel_asset_id       ON meta_channels(meta_asset_id)
 *   CREATE UNIQUE INDEX unique_meta_channels_shop_asset  ON meta_channels(shop_id, meta_asset_id)
 *
 * Safety:
 *   - Existing production rows already satisfy the new constraint because no
 *     shop currently has two rows with the same meta_asset_id (the old
 *     UNIQUE(meta_asset_id) prevented it globally).
 *   - The new index lets the upsert match on (shop_id, meta_asset_id) so
 *     connecting a second page creates a new row instead of overwriting the
 *     first one.
 *   - Postgres CREATE INDEX CONCURRENTLY / DROP INDEX CONCURRENTLY would be
 *     ideal in production, but the existing migration runner uses regular
 *     CREATE/DROP inside a transaction. Table is small (<100 rows in prod) so
 *     a brief lock is acceptable.
 */

module.exports = {
    name: '20260522_012_meta_channels_multi_page_indexes',

    up: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS unique_meta_channel_shop_platform;`);
        console.log('[migration 012] Dropped index unique_meta_channel_shop_platform (if existed).');

        await sequelize.query(`DROP INDEX IF EXISTS unique_meta_channel_asset_id;`);
        console.log('[migration 012] Dropped index unique_meta_channel_asset_id (if existed).');

        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unique_meta_channels_shop_asset
            ON meta_channels(shop_id, meta_asset_id);
        `);
        console.log('[migration 012] Created unique index unique_meta_channels_shop_asset on (shop_id, meta_asset_id).');

        console.log('[migration] 20260522_012_meta_channels_multi_page_indexes: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS unique_meta_channels_shop_asset;`);
        console.log('[migration 012 DOWN] Dropped unique_meta_channels_shop_asset.');

        // Re-create the old global asset uniqueness. Safe because no two shops
        // legitimately own the same meta_asset_id (cross-shop guard at the
        // service layer enforces this).
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unique_meta_channel_asset_id
            ON meta_channels(meta_asset_id);
        `);
        console.log('[migration 012 DOWN] Recreated unique_meta_channel_asset_id.');

        // Re-create the old (shop_id, platform) constraint. This will FAIL if
        // any shop has connected more than one channel of the same platform
        // since Phase 1 shipped. Run a pre-check before rolling back.
        const [dupes] = await sequelize.query(`
            SELECT shop_id, platform, COUNT(*) AS n
            FROM meta_channels
            GROUP BY shop_id, platform
            HAVING COUNT(*) > 1;
        `);
        if (dupes.length > 0) {
            console.error('[migration 012 DOWN] Cannot recreate unique_meta_channel_shop_platform — duplicates exist:', dupes);
            throw new Error('Rollback blocked: shops have multiple channels of the same platform. Resolve before rolling back.');
        }
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unique_meta_channel_shop_platform
            ON meta_channels(shop_id, platform);
        `);
        console.log('[migration 012 DOWN] Recreated unique_meta_channel_shop_platform.');

        console.log('[migration] 20260522_012_meta_channels_multi_page_indexes: DOWN complete');
    }
};
