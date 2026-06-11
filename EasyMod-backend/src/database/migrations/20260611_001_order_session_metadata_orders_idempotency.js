'use strict';

/**
 * Migration: 20260611_001_order_session_metadata_orders_idempotency
 *
 * Root-cause fix for "AI confirms the order in chat but no Order is created"
 * (live test 2026-06-11, conv 40512fa9).
 *
 * 1. order_sessions.metadata — the OrderSession model gained a `metadata` JSON
 *    column after 20260522_004 was written, so the column never reached prod.
 *    Sequelize SELECTs every model attribute, so the very first query of the
 *    order flow (getActiveSession) failed with `column "metadata" does not
 *    exist` on EVERY message. The worker swallowed the error and fell through
 *    to the conversational LLM, which role-played the whole order with no row.
 *
 * 2. order_sessions.customer_id — squash created it NOT NULL, but the entity
 *    declares allowNull and order-flow deliberately supports sessions without
 *    a linked customer. Next crash in line once metadata is fixed.
 *
 * 3. orders.idempotency_key / orders.usage_transaction_id — order.service
 *    queries `where: { idempotency_key }` whenever a requestId is passed (the
 *    chatbot path always passes session.id) and writes usage_transaction_id
 *    after usage tracking. Neither column ever existed in prod, so chatbot
 *    order creation would crash even after (1)+(2). Entity gains both fields
 *    in the same PR.
 */

module.exports = {
    name: '20260611_001_order_session_metadata_orders_idempotency',

    up: async (sequelize) => {
        // ── 1. order_sessions.metadata (model: DataTypes.JSON, default {}) ──
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';`);

        // ── 2. order_sessions.customer_id → nullable (entity: allowNull true) ──
        await sequelize.query(`ALTER TABLE order_sessions ALTER COLUMN customer_id DROP NOT NULL;`);

        // ── 3. orders idempotency + usage tracking columns ──
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS usage_transaction_id VARCHAR(255);`);
        // One order per idempotency key per shop (retried session confirms must
        // return the same order, never create a duplicate).
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_idempotency
            ON orders(shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;`);

        console.log('[migration] 20260611_001_order_session_metadata_orders_idempotency: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS idx_orders_shop_idempotency;`);
        await sequelize.query(`ALTER TABLE orders DROP COLUMN IF EXISTS usage_transaction_id;`);
        await sequelize.query(`ALTER TABLE orders DROP COLUMN IF EXISTS idempotency_key;`);
        // customer_id is intentionally left nullable on down: restoring NOT NULL
        // would fail if any session rows with NULL customer_id exist by then.
        await sequelize.query(`ALTER TABLE order_sessions DROP COLUMN IF EXISTS metadata;`);

        console.log('[migration] 20260611_001_order_session_metadata_orders_idempotency: DOWN complete');
    }
};
