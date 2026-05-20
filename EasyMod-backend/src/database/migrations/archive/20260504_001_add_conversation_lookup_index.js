'use strict';

/**
 * Migration: add composite lookup index for conversation list queries.
 *
 * idx_conv_shop_customer — covers the most common inbox query:
 *   WHERE shop_id = ? AND customer_id = ? AND channel = ?
 *   ORDER BY created_at DESC
 *
 * Created with CONCURRENTLY so it does not lock the production table during deployment.
 */
module.exports = {
    name: '20260504_001_add_conversation_lookup_index',

    up: async (sequelize) => {
        // CONCURRENTLY cannot run inside a transaction; execute as raw query
        await sequelize.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_shop_customer
             ON conversations(shop_id, customer_id, channel, created_at DESC)`
        ).catch(() => {});
    },

    down: async (sequelize) => {
        await sequelize.query(
            'DROP INDEX CONCURRENTLY IF EXISTS idx_conv_shop_customer'
        ).catch(() => {});
    }
};
