'use strict';

/**
 * MW-V1 Phase 5: CRM Lite internal customer notes.
 *
 * customer_notes — staff-private, merchant-entered service context bound to
 * the shop-scoped customer. Body text exists ONLY in this table: audit rows
 * carry references and lengths, never content. Soft-deleted rows stay for
 * retention review until an authorized erasure. Additive only; reversible by
 * dropping the table.
 */
module.exports = {
    name: '20261025_003_customer_notes',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS customer_notes (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
                author_id    UUID REFERENCES users(id) ON DELETE SET NULL,
                author_name  VARCHAR(160),
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at   TIMESTAMPTZ
            );
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_notes_shop_customer
                ON customer_notes(shop_id, customer_id, created_at DESC);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_notes_shop_deleted
                ON customer_notes(shop_id) WHERE deleted_at IS NULL;
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP TABLE IF EXISTS customer_notes;');
    },
};
