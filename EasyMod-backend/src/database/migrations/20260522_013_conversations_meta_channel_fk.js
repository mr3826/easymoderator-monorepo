'use strict';

/**
 * Migration: 20260522_013_conversations_meta_channel_fk
 *
 * Phase 2 of the multi-channel identity rework. Adds an explicit FK from each
 * conversation row to the specific meta_channels row it belongs to. Without
 * this, per-page attribution in the inbox (and correct outbound token routing)
 * is impossible — conversations.channel is just the platform string
 * ('messenger' / 'instagram'), shared across all pages of a shop.
 *
 * Changes:
 *   ALTER TABLE conversations ADD COLUMN meta_channel_id UUID NULL
 *     REFERENCES meta_channels(id) ON DELETE SET NULL
 *   CREATE INDEX idx_conversations_meta_channel_id ON conversations(meta_channel_id)
 *   Backfill: join on (shop_id + platform match) — unambiguous immediately after
 *     Phase 1, since no shop has connected a second page yet.
 *
 * Safety:
 *   - Column is nullable; existing application code that does not yet pass
 *     meta_channel_id continues to work. Phase 4 will tighten this once all
 *     creation paths populate it.
 *   - Backfill skips rows where the join is ambiguous (>1 meta_channels row
 *     for the same shop+platform mapping). This happens only if a second page
 *     was connected between Phase 1 and Phase 2 going live. Those rows are
 *     logged and left NULL; the application can fill them in lazily on next
 *     inbound message.
 *   - ON DELETE SET NULL preserves conversation history if a channel is later
 *     hard-deleted (we soft-disconnect today, so this is belt-and-suspenders).
 */

module.exports = {
    name: '20260522_013_conversations_meta_channel_fk',

    up: async (sequelize) => {
        const [colCheck] = await sequelize.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'conversations' AND column_name = 'meta_channel_id';
        `);

        if (colCheck.length === 0) {
            await sequelize.query(`
                ALTER TABLE conversations
                ADD COLUMN meta_channel_id UUID NULL
                REFERENCES meta_channels(id) ON DELETE SET NULL;
            `);
            console.log('[migration 013] Added conversations.meta_channel_id (UUID, nullable, FK).');
        } else {
            console.log('[migration 013] conversations.meta_channel_id already exists, skip add.');
        }

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_conversations_meta_channel_id
            ON conversations(meta_channel_id);
        `);
        console.log('[migration 013] Ensured idx_conversations_meta_channel_id.');

        // Backfill: assign meta_channel_id by matching (shop_id, channel-string → platform).
        // Skip rows where the (shop_id, platform) join is ambiguous (multiple channels).
        // After Phase 1 + immediate Phase 2 deploy, ambiguity is essentially zero.
        const [ambiguous] = await sequelize.query(`
            SELECT shop_id, platform, COUNT(*) AS n
            FROM meta_channels
            GROUP BY shop_id, platform
            HAVING COUNT(*) > 1;
        `);
        if (ambiguous.length > 0) {
            console.warn(
                `[migration 013] ${ambiguous.length} (shop, platform) groups have multiple channels — those conversations will be left meta_channel_id=NULL and filled lazily by app code.`,
                ambiguous.slice(0, 10)
            );
        }

        const [backfillResult] = await sequelize.query(`
            UPDATE conversations c
            SET meta_channel_id = mc.id
            FROM meta_channels mc
            WHERE c.meta_channel_id IS NULL
              AND c.shop_id = mc.shop_id
              AND (
                    (c.channel IN ('messenger', 'facebook') AND mc.platform = 'facebook')
                 OR (c.channel = 'instagram' AND mc.platform = 'instagram')
              )
              AND NOT EXISTS (
                    SELECT 1 FROM meta_channels mc2
                    WHERE mc2.shop_id = mc.shop_id
                      AND mc2.platform = mc.platform
                      AND mc2.id <> mc.id
              )
            RETURNING c.id;
        `);
        console.log(`[migration 013] Backfilled meta_channel_id on ${backfillResult.length} conversation rows.`);

        console.log('[migration] 20260522_013_conversations_meta_channel_fk: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS idx_conversations_meta_channel_id;`);
        await sequelize.query(`ALTER TABLE conversations DROP COLUMN IF EXISTS meta_channel_id;`);
        console.log('[migration] 20260522_013_conversations_meta_channel_fk: DOWN complete');
    }
};
