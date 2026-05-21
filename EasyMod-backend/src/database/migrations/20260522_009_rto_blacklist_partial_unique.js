'use strict';

/**
 * Migration: 20260522_009_rto_blacklist_partial_unique
 *
 * Problem:
 *   rto_blacklist has UNIQUE(shop_id, phone). When is_global=true, shop_id is NULL.
 *   PostgreSQL treats NULL != NULL in unique indexes, so multiple global rows for
 *   the same phone are technically allowed, but the semantics break: you can get
 *   duplicate global blacklist entries per phone number.
 *
 * Solution:
 *   Drop the existing full UNIQUE(shop_id, phone) constraint.
 *   Add two partial unique indexes:
 *     a. idx_rto_shop_phone       — UNIQUE(shop_id, phone) WHERE shop_id IS NOT NULL
 *        Enforces per-tenant uniqueness for shop-scoped entries.
 *     b. idx_rto_global_phone     — UNIQUE(phone) WHERE is_global = true
 *        Enforces global-uniqueness: only one global blacklist entry per phone number.
 *
 * Pre-flight:
 *   Verifies no existing data would violate the new indexes before dropping + recreating.
 *   If violations are found, migration logs a warning but still proceeds
 *   (duplicates were impossible under the old constraint for shop-scoped rows;
 *   for global rows, true duplicates might exist in theory — we log them).
 */

module.exports = {
    name: '20260522_009_rto_blacklist_partial_unique',

    up: async (sequelize) => {

        // ── Pre-flight: check for global phone duplicates ─────────────────────────
        const [globalDups] = await sequelize.query(`
            SELECT phone, COUNT(*) AS cnt
            FROM rto_blacklist
            WHERE is_global = true
            GROUP BY phone
            HAVING COUNT(*) > 1;
        `);
        if (globalDups.length > 0) {
            console.warn(`[migration 009] WARNING: ${globalDups.length} phone number(s) have duplicate global entries.`);
            console.warn('[migration 009] Deduplication: keeping the most recent global entry per phone.');
            // Keep only the latest global entry per phone to allow the new unique index to be created
            await sequelize.query(`
                DELETE FROM rto_blacklist
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id,
                               ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at DESC) AS rn
                        FROM rto_blacklist
                        WHERE is_global = true
                    ) ranked
                    WHERE rn > 1
                );
            `);
            console.log('[migration 009] Global duplicates removed — kept most recent per phone.');
        }

        // ── Drop existing UNIQUE constraint on (shop_id, phone) ──────────────────
        // The constraint may be named differently depending on how Sequelize/squash created it.
        // We find and drop any unique constraint/index covering exactly (shop_id, phone)
        // on the rto_blacklist table.
        const [existingConstraints] = await sequelize.query(`
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE rel.relname = 'rto_blacklist'
              AND con.contype = 'u';
        `);

        for (const row of existingConstraints) {
            // Check which columns this constraint covers
            const [conCols] = await sequelize.query(`
                SELECT a.attname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = ANY(con.conkey)
                WHERE rel.relname = 'rto_blacklist'
                  AND con.conname = '${row.conname}';
            `);
            const cols = conCols.map(c => c.attname).sort();
            if (JSON.stringify(cols) === JSON.stringify(['phone', 'shop_id'])) {
                await sequelize.query(`ALTER TABLE rto_blacklist DROP CONSTRAINT IF EXISTS "${row.conname}";`);
                console.log(`[migration 009] Dropped unique constraint: ${row.conname}`);
            }
        }

        // Also drop any unique index (not constraint) on (shop_id, phone) without WHERE clause
        const [existingIndexes] = await sequelize.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'rto_blacklist'
              AND indexdef LIKE '%UNIQUE%';
        `);

        for (const idx of existingIndexes) {
            // Skip the new partial indexes we're about to create (idempotency)
            if (idx.indexname === 'idx_rto_shop_phone' || idx.indexname === 'idx_rto_global_phone') {
                continue;
            }
            // Drop any existing non-partial unique index covering (shop_id, phone)
            if (idx.indexdef.includes('shop_id') && idx.indexdef.includes('phone') && !idx.indexdef.includes('WHERE')) {
                await sequelize.query(`DROP INDEX IF EXISTS "${idx.indexname}";`);
                console.log(`[migration 009] Dropped unique index: ${idx.indexname}`);
            }
        }

        // ── Create partial unique indexes ─────────────────────────────────────────
        // a. Shop-scoped entries: UNIQUE(shop_id, phone) WHERE shop_id IS NOT NULL
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_rto_shop_phone
            ON rto_blacklist(shop_id, phone)
            WHERE shop_id IS NOT NULL;
        `);
        console.log('[migration 009] Created: idx_rto_shop_phone (shop-scoped partial unique)');

        // b. Global entries: UNIQUE(phone) WHERE is_global = true
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_rto_global_phone
            ON rto_blacklist(phone)
            WHERE is_global = true;
        `);
        console.log('[migration 009] Created: idx_rto_global_phone (global partial unique)');

        console.log('[migration] 20260522_009_rto_blacklist_partial_unique: UP complete');
    },

    down: async (sequelize) => {
        // Drop the two partial indexes
        await sequelize.query(`DROP INDEX IF EXISTS idx_rto_global_phone;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_rto_shop_phone;`);

        // Restore the original full UNIQUE(shop_id, phone) constraint
        // This may fail if global rows with NULL shop_id exist — acceptable for rollback
        await sequelize.query(`
            ALTER TABLE rto_blacklist
            ADD CONSTRAINT rto_blacklist_shop_id_phone_key UNIQUE (shop_id, phone);
        `).catch((err) => {
            console.warn(`[migration 009 DOWN] Could not restore full UNIQUE constraint: ${err.message}`);
        });

        console.log('[migration] 20260522_009_rto_blacklist_partial_unique: DOWN complete');
    }
};
