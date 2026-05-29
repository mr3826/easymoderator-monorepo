'use strict';

/**
 * Migration: 20260523_017_orders_shop_delivery_status_idx
 *
 * Adds a composite index on (shop_id, delivery_status) to support the
 * cashInTransit and atRisk aggregations in dashboard.service.js.
 * Without this index, the two new SUM/COUNT queries fall back to a
 * shop_id index scan + in-memory filter on delivery_status, which
 * degrades on shops with high order volume.
 */

module.exports = {
    name: '20260523_017_orders_shop_delivery_status_idx',

    up: async (sequelize) => {
        await sequelize.query(
            `CREATE INDEX IF NOT EXISTS idx_orders_shop_delivery_status
             ON orders (shop_id, delivery_status);`
        );
        console.log('[migration] 20260523_017_orders_shop_delivery_status_idx: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(
            `DROP INDEX IF EXISTS idx_orders_shop_delivery_status;`
        );
        console.log('[migration] 20260523_017_orders_shop_delivery_status_idx: DOWN complete');
    }
};
