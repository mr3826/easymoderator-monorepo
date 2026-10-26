'use strict';

/**
 * IC-V1 review F4 — DB-level enforcement of create-order idempotency.
 *
 * The application path (advisory xact lock + in-transaction replay recheck in
 * order.service.createOrderInternal) no-ops on non-postgres dialects, and an
 * advisory lock only serializes holders — a duplicate that predates it stays
 * invisible. This partial unique index makes a duplicated committed
 * (shop_id, idempotency_key) pair impossible at storage level, for every
 * dialect that supports partial indexes.
 *
 * up fails LOUDLY when existing rows already violate the invariant: silent
 * enforcement over dirty data is worse than a deployment that names the
 * duplicates and demands reconciliation first.
 */
module.exports = {
    name: '20261026_001_order_idempotency_unique',

    up: async (sequelize) => {
        const [duplicates] = await sequelize.query(`
            SELECT shop_id, idempotency_key, COUNT(*) AS occurrences
            FROM orders
            WHERE idempotency_key IS NOT NULL
            GROUP BY shop_id, idempotency_key
            HAVING COUNT(*) > 1
            LIMIT 5;
        `);
        if (Array.isArray(duplicates) && duplicates.length > 0) {
            throw new Error(
                'Cannot enforce order idempotency uniqueness: duplicated (shop_id, idempotency_key) rows exist. '
                + 'Reconcile duplicate orders before deploying this migration.',
            );
        }
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_idempotency_unique
                ON orders(shop_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL;
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP INDEX IF EXISTS idx_orders_shop_idempotency_unique;');
    },
};
