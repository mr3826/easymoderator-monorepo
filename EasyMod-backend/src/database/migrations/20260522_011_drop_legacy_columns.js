'use strict';

/**
 * Migration: 20260522_011_drop_legacy_columns
 *
 * Drops two pairs of legacy columns that existed in the squash schema but have been
 * superseded by new columns. New columns were backfilled in earlier migrations.
 *
 * ── Item 7: idempotency_keys ─────────────────────────────────────────────────
 *   Legacy columns:  key VARCHAR(255), response JSONB
 *   New columns:     idempotency_key VARCHAR(255), response_data JSONB
 *
 *   Evidence of safety:
 *   - All app code references 'idempotency_key' and 'response_data' exclusively.
 *   - audit.service.js: findOrCreate uses where:{idempotency_key}, defaults include response_data.
 *   - idempotency.middleware.js: reads req.headers, passes to audit service — no raw SQL.
 *   - No file in src/modules/ references the column name 'key' in a DB context.
 *   - Migration 003 already backfilled: UPDATE SET idempotency_key = key, response_data = response.
 *   - The old UNIQUE(shop_id, key) constraint was replaced by idx_idempotency_shop_key
 *     on (idempotency_key, shop_id) in the archive migration 20260218_002.
 *
 * ── Item 8: orders ────────────────────────────────────────────────────────────
 *   Legacy column: status VARCHAR (from squash)
 *   New column:    order_status VARCHAR (from entity)
 *
 *   Evidence of safety:
 *   - All app code in src/modules/order/ uses 'order_status' — grepped clean.
 *   - order.entity.js has no 'status' field, only 'order_status'.
 *   - order.service.js, return.service.js, order.controller.js — all use order_status.
 *   - Migration 004 already backfilled: UPDATE SET order_status = status WHERE order_status = 'draft'.
 *
 * Both drops are guarded with IF EXISTS so the migration is idempotent.
 */

module.exports = {
    name: '20260522_011_drop_legacy_columns',

    up: async (sequelize) => {

        // ── 1. idempotency_keys: drop legacy 'key' column ─────────────────────────
        const [keyCol] = await sequelize.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'idempotency_keys' AND column_name = 'key';
        `);
        if (keyCol.length > 0) {
            // Before dropping, verify new column has data (sanity check)
            const [backfillCheck] = await sequelize.query(`
                SELECT COUNT(*) AS orphans
                FROM idempotency_keys
                WHERE key IS NOT NULL AND idempotency_key IS NULL;
            `);
            const orphans = parseInt(backfillCheck[0].orphans, 10);
            if (orphans > 0) {
                // Backfill any remaining rows that migration 003 may have missed
                await sequelize.query(`
                    UPDATE idempotency_keys
                    SET idempotency_key = key
                    WHERE idempotency_key IS NULL AND key IS NOT NULL;
                `);
                console.log(`[migration 011] idempotency_keys: backfilled ${orphans} remaining rows before drop.`);
            }
            await sequelize.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS key;`);
            console.log('[migration 011] Dropped: idempotency_keys.key');
        } else {
            console.log('[migration 011] idempotency_keys.key: already dropped, skip.');
        }

        // ── 2. idempotency_keys: drop legacy 'response' column ───────────────────
        const [responseCol] = await sequelize.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'idempotency_keys' AND column_name = 'response';
        `);
        if (responseCol.length > 0) {
            const [responseCheck] = await sequelize.query(`
                SELECT COUNT(*) AS orphans
                FROM idempotency_keys
                WHERE response IS NOT NULL AND response_data IS NULL;
            `);
            const orphans = parseInt(responseCheck[0].orphans, 10);
            if (orphans > 0) {
                await sequelize.query(`
                    UPDATE idempotency_keys
                    SET response_data = response
                    WHERE response_data IS NULL AND response IS NOT NULL;
                `);
                console.log(`[migration 011] idempotency_keys: backfilled response_data for ${orphans} rows before drop.`);
            }
            await sequelize.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS response;`);
            console.log('[migration 011] Dropped: idempotency_keys.response');
        } else {
            console.log('[migration 011] idempotency_keys.response: already dropped, skip.');
        }

        // Also clean up the legacy index idx_idem_shop_key that covered (shop_id, key)
        await sequelize.query(`DROP INDEX IF EXISTS idx_idem_shop_key;`);
        console.log('[migration 011] Dropped legacy index idx_idem_shop_key (if existed).');

        // ── 3. orders: drop legacy 'status' column ────────────────────────────────
        const [statusCol] = await sequelize.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'status';
        `);
        if (statusCol.length > 0) {
            // Sanity backfill: any rows where order_status is still 'draft' but status has a real value
            const [orderCheck] = await sequelize.query(`
                SELECT COUNT(*) AS orphans
                FROM orders
                WHERE status IS NOT NULL AND (order_status IS NULL OR order_status = 'draft') AND status != 'draft';
            `);
            const orphans = parseInt(orderCheck[0].orphans, 10);
            if (orphans > 0) {
                await sequelize.query(`
                    UPDATE orders
                    SET order_status = status
                    WHERE (order_status IS NULL OR order_status = 'draft')
                      AND status IS NOT NULL
                      AND status != 'draft';
                `);
                console.log(`[migration 011] orders: backfilled order_status from status for ${orphans} rows before drop.`);
            }

            // Drop legacy index that covered (shop_id, status) if it still exists
            await sequelize.query(`DROP INDEX IF EXISTS idx_orders_status;`);
            await sequelize.query(`ALTER TABLE orders DROP COLUMN IF EXISTS status;`);
            console.log('[migration 011] Dropped: orders.status + legacy idx_orders_status.');
        } else {
            console.log('[migration 011] orders.status: already dropped, skip.');
        }

        console.log('[migration] 20260522_011_drop_legacy_columns: UP complete');
    },

    down: async (sequelize) => {
        // Restore legacy columns (empty — they have no data post-drop)
        // This is a best-effort rollback; data written after the drop will not be in the legacy columns.

        // orders.status
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(50);`);
        await sequelize.query(`UPDATE orders SET status = order_status WHERE status IS NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(shop_id, status);`);
        console.log('[migration 011 DOWN] Restored orders.status (backfilled from order_status).');

        // idempotency_keys.response
        await sequelize.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response JSONB;`);
        await sequelize.query(`UPDATE idempotency_keys SET response = response_data WHERE response IS NULL;`);
        console.log('[migration 011 DOWN] Restored idempotency_keys.response.');

        // idempotency_keys.key
        await sequelize.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS key VARCHAR(255);`);
        await sequelize.query(`UPDATE idempotency_keys SET key = idempotency_key WHERE key IS NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_idem_shop_key ON idempotency_keys(shop_id, key);`);
        console.log('[migration 011 DOWN] Restored idempotency_keys.key.');

        console.log('[migration] 20260522_011_drop_legacy_columns: DOWN complete');
    }
};
