'use strict';

/**
 * Migration: 20260624_001_disconnect_instagram_channels
 *
 * Facebook-only launch: Instagram was removed from product scope (2026-06-24).
 * Any pre-existing meta_channels rows with platform='instagram' can no longer be
 * served (the Instagram provider, OAuth flow, and webhook handler are gone), so
 * this guard marks them DISCONNECTED to make the cutover deterministic.
 *
 * NON-DESTRUCTIVE BY DESIGN:
 *   - The Postgres enum value 'instagram' and the legacy linked_fb_page_id column
 *     are intentionally LEFT in place (dropping enum values on Postgres is risky
 *     and unnecessary). The narrowed Sequelize entity prevents any new IG writes.
 *   - Expected to affect 0 rows in production (Instagram never passed App Review,
 *     so no real merchant ever connected an IG channel).
 *
 * Idempotent and dialect-aware: guarded by table existence, and the
 * `status <> 'DISCONNECTED'` predicate means re-running is a no-op.
 *
 * Irreversible by design: `down` is a no-op — Instagram is not being reintroduced
 * for this launch.
 */
module.exports = {
    name: '20260624_001_disconnect_instagram_channels',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();

        if (dialect === 'postgres') {
            await sequelize.query(`
                DO $$
                BEGIN
                    IF to_regclass('public.meta_channels') IS NOT NULL THEN
                        UPDATE meta_channels
                           SET status = 'DISCONNECTED',
                               disconnected_at = NOW(),
                               last_error = 'instagram_removed_from_product_scope'
                         WHERE platform = 'instagram'
                           AND status <> 'DISCONNECTED';
                    END IF;
                END $$;
            `);
        } else {
            // dev/sqlite (db:sync). The table is created from the entity, whose
            // enum no longer includes 'instagram', so this is a harmless no-op.
            try {
                await sequelize.query(`
                    UPDATE meta_channels
                       SET status = 'DISCONNECTED',
                           disconnected_at = CURRENT_TIMESTAMP,
                           last_error = 'instagram_removed_from_product_scope'
                     WHERE platform = 'instagram'
                       AND status <> 'DISCONNECTED';
                `);
            } catch (_) {
                // table may not exist yet in some sync contexts — safe to ignore
            }
        }
    },

    down: async () => {
        // Intentionally irreversible — Instagram has been removed from product scope.
    }
};
