/**
 * Follow-up to 20260611_003: relax two squash-era NOT NULLs that contradict
 * explicit entity/service intent (audit "warning" class — the column exists
 * in both, but the DB demands a value the code legitimately omits).
 *
 * - orders.customer_id: the chatbot confirm step passes
 *   `customer_id: session.customer_id || null` by design — orders carry
 *   denormalized customer_name/customer_phone and need no Customer row.
 *   With the column NOT NULL, a chatbot order with no linked customer dies
 *   on the INSERT right after order-number generation.
 * - rto_blacklist.shop_id: global blacklist entries are created with
 *   `shop_id: shop_id || null` (is_global = true) — NOT NULL breaks them.
 *
 * push_subscriptions.user_id stays NOT NULL: the only writer is an
 * authenticated route that always supplies it.
 */

module.exports = {
    name: '20260611_004_relax_not_null_drift',

    up: async (sequelize) => {
        if (sequelize.getDialect() !== 'postgres') return;
        // DROP NOT NULL is a no-op when already nullable — safe to re-run.
        await sequelize.query(`ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;`);
        await sequelize.query(`ALTER TABLE rto_blacklist ALTER COLUMN shop_id DROP NOT NULL;`);
    },

    down: async (sequelize) => {
        if (sequelize.getDialect() !== 'postgres') return;
        // Restoring NOT NULL would fail if null rows exist by then; scope the
        // reverse to rows that allow it, mirroring the original constraint.
        await sequelize.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM orders WHERE customer_id IS NULL) THEN
                    ALTER TABLE orders ALTER COLUMN customer_id SET NOT NULL;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM rto_blacklist WHERE shop_id IS NULL) THEN
                    ALTER TABLE rto_blacklist ALTER COLUMN shop_id SET NOT NULL;
                END IF;
            END $$;
        `);
    }
};
