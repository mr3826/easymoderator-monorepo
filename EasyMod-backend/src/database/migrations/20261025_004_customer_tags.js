'use strict';

/**
 * MW-V1 Phase 6 — controlled merchant tags (doc 05):
 *  customer_tag_definitions — shop-scoped vocabulary, normalized lowercase
 *  column for case-insensitive uniqueness, bounded naming (service-level
 *  reserved-name blocklist keeps DERIVED engine statuses out of manual tags).
 *  customer_tag_assignments — idempotent m:n (UNIQUE(tag_id, customer_id)).
 * Additive only; reversible by dropping both tables.
 */
module.exports = {
    name: '20261025_004_customer_tags',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS customer_tag_definitions (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                name        VARCHAR(30) NOT NULL,
                name_lower  VARCHAR(30) NOT NULL,
                created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT customer_tags_name_unique_per_shop UNIQUE (shop_id, name_lower)
            );
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_tags_shop
                ON customer_tag_definitions(shop_id, name_lower);
        `);
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS customer_tag_assignments (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                tag_id      UUID NOT NULL REFERENCES customer_tag_definitions(id) ON DELETE CASCADE,
                customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT customer_tag_assignment_unique UNIQUE (tag_id, customer_id)
            );
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_tag_assign_customer
                ON customer_tag_assignments(shop_id, customer_id);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP TABLE IF EXISTS customer_tag_assignments;');
        await sequelize.query('DROP TABLE IF EXISTS customer_tag_definitions;');
    },
};
