'use strict';

/**
 * Migration: 20260522_006_fix_schema_drift_catalog_content
 *
 * Domain: Catalog, Content, Audit
 *
 * Entities covered:
 *   - Category          → missing cover_image, image
 *   - ProductVariant    → squash has name/stock/attributes; entity uses
 *                         option_name/option_value/quantity/compare_at_price
 *   - KnownArea         → entity zone_type is ENUM; squash uses VARCHAR(50)
 *                         (no column missing; ENUM type will be created at sync)
 *   - ResponseTemplate  → squash has language/tags; entity has variables/category
 *   - KnowledgeGap      → squash has frequency/last_seen/status/updated_at;
 *                         entity has platform/language/source
 *   - AuditLog          → squash has action/resource/resource_id; entity has
 *                         action/resource_type/resource_id, plus old_values,
 *                         new_values, idempotency_key columns
 */

module.exports = {
    name: '20260522_006_fix_schema_drift_catalog_content',

    up: async (sequelize) => {

        // ── 1. categories ─────────────────────────────────────────────────────────
        await sequelize.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS cover_image VARCHAR(500);`);
        await sequelize.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS image VARCHAR(500);`);

        // ── 2. product_variants ──────────────────────────────────────────────────
        // Squash: name VARCHAR(255), stock INTEGER, attributes JSONB
        // Entity: option_name VARCHAR(100), option_value VARCHAR(255),
        //         quantity INTEGER, compare_at_price DECIMAL
        // Add entity columns; leave squash columns in place.
        await sequelize.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS option_name VARCHAR(100) DEFAULT 'Variant';`);
        await sequelize.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS option_value VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS compare_at_price DECIMAL(10,2);`);
        // Backfill option_name/option_value from squash 'name'
        await sequelize.query(`UPDATE product_variants SET option_value = name WHERE option_value IS NULL AND name IS NOT NULL;`);
        // Backfill quantity from squash 'stock'
        await sequelize.query(`UPDATE product_variants SET quantity = stock WHERE quantity = 0 AND stock > 0;`);
        // Partial unique index entity declares
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pv_product_sku ON product_variants(product_id, sku) WHERE sku IS NOT NULL;`);

        // ── 3. known_areas ────────────────────────────────────────────────────────
        // Entity zone_type is ENUM('inside_city','outside_city','suburban').
        // Squash uses VARCHAR(50). No column missing — Sequelize will try to use
        // the ENUM type at runtime. Add the ENUM type and alter the column type
        // so INSERT of ENUM values works correctly.
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_known_areas_zone_type') THEN
                    CREATE TYPE enum_known_areas_zone_type AS ENUM ('inside_city', 'outside_city', 'suburban');
                END IF;
            END $$;
        `);
        // Note: we do NOT alter the column type here — existing VARCHAR data may
        // not conform to the ENUM values. Listed in product-review items.

        // ── 4. response_templates ─────────────────────────────────────────────────
        // Squash: language VARCHAR(10), tags JSONB
        // Entity: variables JSON, category STRING
        await sequelize.query(`ALTER TABLE response_templates ADD COLUMN IF NOT EXISTS variables JSONB DEFAULT '[]';`);
        await sequelize.query(`ALTER TABLE response_templates ADD COLUMN IF NOT EXISTS category VARCHAR(100);`);

        // ── 5. knowledge_gaps ─────────────────────────────────────────────────────
        // Squash: question TEXT, frequency INTEGER, last_seen TIMESTAMPTZ,
        //         status VARCHAR(50), id UUID
        // Entity: question TEXT, platform VARCHAR(50), language VARCHAR(20),
        //         source VARCHAR(100), id INTEGER SERIAL
        // NOTE: id type mismatch (UUID vs INTEGER serial). The entity uses INTEGER.
        // We cannot safely change the PK type. This is a product-review item.
        // Add only the missing content columns.
        await sequelize.query(`ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS platform VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS language VARCHAR(20) DEFAULT 'mixed';`);
        await sequelize.query(`ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'ai_handler';`);

        // ── 6. audit_logs ─────────────────────────────────────────────────────────
        // Squash: action VARCHAR(255), resource VARCHAR(100), resource_id VARCHAR(255)
        // Entity: action VARCHAR(128), resource_type VARCHAR(64), resource_id STRING
        // Entity also has: old_values JSON, new_values JSON, idempotency_key STRING
        // Add entity columns; 'resource' stays as squash column.
        await sequelize.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type VARCHAR(64);`);
        await sequelize.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_values JSONB;`);
        await sequelize.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_values JSONB;`);
        await sequelize.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);`);
        // Backfill resource_type from resource where present
        await sequelize.query(`UPDATE audit_logs SET resource_type = resource WHERE resource_type IS NULL AND resource IS NOT NULL;`);
        // Entity indexes
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs(user_id, created_at);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_shop_type_created ON audit_logs(shop_id, resource_type, created_at);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_idem_key ON audit_logs(idempotency_key) WHERE idempotency_key IS NOT NULL;`);

        console.log('[migration] 20260522_006_fix_schema_drift_catalog_content: UP complete');
    },

    down: async (sequelize) => {
        // audit_logs
        await sequelize.query(`DROP INDEX IF EXISTS idx_audit_idem_key;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_audit_shop_type_created;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_audit_resource;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_audit_user_created;`);
        await sequelize.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS idempotency_key;`);
        await sequelize.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS new_values;`);
        await sequelize.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS old_values;`);
        await sequelize.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS resource_type;`);

        // knowledge_gaps
        await sequelize.query(`ALTER TABLE knowledge_gaps DROP COLUMN IF EXISTS source;`);
        await sequelize.query(`ALTER TABLE knowledge_gaps DROP COLUMN IF EXISTS language;`);
        await sequelize.query(`ALTER TABLE knowledge_gaps DROP COLUMN IF EXISTS platform;`);

        // response_templates
        await sequelize.query(`ALTER TABLE response_templates DROP COLUMN IF EXISTS category;`);
        await sequelize.query(`ALTER TABLE response_templates DROP COLUMN IF EXISTS variables;`);

        // known_areas (ENUM type only — no column to drop)
        await sequelize.query(`DROP TYPE IF EXISTS enum_known_areas_zone_type;`).catch(() => {});

        // product_variants
        await sequelize.query(`DROP INDEX IF EXISTS idx_pv_product_sku;`);
        await sequelize.query(`ALTER TABLE product_variants DROP COLUMN IF EXISTS compare_at_price;`);
        await sequelize.query(`ALTER TABLE product_variants DROP COLUMN IF EXISTS quantity;`);
        await sequelize.query(`ALTER TABLE product_variants DROP COLUMN IF EXISTS option_value;`);
        await sequelize.query(`ALTER TABLE product_variants DROP COLUMN IF EXISTS option_name;`);

        // categories
        await sequelize.query(`ALTER TABLE categories DROP COLUMN IF EXISTS image;`);
        await sequelize.query(`ALTER TABLE categories DROP COLUMN IF EXISTS cover_image;`);

        console.log('[migration] 20260522_006_fix_schema_drift_catalog_content: DOWN complete');
    }
};
