'use strict';

/**
 * Migration: add performance indexes for inbox, thread, and token tracking queries.
 *
 * idx_conversations_shop_updated  — fastest path for shop inbox (shop_id + ORDER BY updated_at)
 * idx_messages_conversation_created — fastest path for message thread pagination
 * idx_messages_shop_date         — needed for per-shop daily token budget queries
 *
 * All created with CONCURRENTLY so they don't lock production tables.
 */
module.exports = {
    name: '20260321_002_performance_indexes',

    up: async (sequelize) => {
        const q = sequelize.getQueryInterface();
        // CONCURRENTLY cannot run inside a transaction; execute raw with plain query
        await sequelize.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_shop_updated
             ON conversations(shop_id, updated_at DESC)`
        ).catch(() => {});

        await sequelize.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_created
             ON messages(conversation_id, created_at ASC)`
        ).catch(() => {});

        await sequelize.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_shop_date
             ON messages(shop_id, DATE(created_at))`
        ).catch(() => {});
    },

    down: async (sequelize) => {
        await sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS idx_conversations_shop_updated').catch(() => {});
        await sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS idx_messages_conversation_created').catch(() => {});
        await sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS idx_messages_shop_date').catch(() => {});
    }
};
