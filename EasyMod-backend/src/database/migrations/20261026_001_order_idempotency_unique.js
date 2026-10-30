'use strict';

/**
 * IC-V1 review F4 — reconcile DB-level enforcement of create-order idempotency.
 *
 * PRODUCTION-SHAPED DRY-RUN FINDING (release-readiness milestone): migration
 * 20260611_001_order_session_metadata_orders_idempotency has created the
 * partial unique index idx_orders_shop_idempotency on
 * (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL since June.
 * An earlier draft of this migration instead created a SECOND uniquely-named
 * index over identical columns — legal but duplicated storage and a model that
 * disagreed with reality.
 *
 * This version is a reconciliation step:
 *   - drops the redundant idx_orders_shop_idempotency_unique if any database
 *     already ran the earlier draft (lab/dev catalogs only);
 *   - keeps exactly one canonical partial unique index;
 *   - if the canonical index is somehow absent (a catalog older than the June
 *     migration that failed its CREATE), re-creates it, but REFUSES LOUDLY
 *     when existing rows already violate the invariant — silent enforcement
 *     over dirty data is worse than a deployment that names the duplicates.
 *
 * down() only reverses this migration's own artifact (the redundant name) and
 * never touches the June object.
 */
module.exports = {
    name: '20261026_001_order_idempotency_unique',

    up: async (sequelize) => {
        await sequelize.query('DROP INDEX IF EXISTS idx_orders_shop_idempotency_unique;');
        const [canonical] = await sequelize.query(`
            SELECT 1 FROM pg_indexes
            WHERE tablename = 'orders' AND indexname = 'idx_orders_shop_idempotency';
        `);
        if (canonical.length > 0) return;
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
            CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_idempotency
                ON orders(shop_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL;
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP INDEX IF EXISTS idx_orders_shop_idempotency_unique;');
    },
};
