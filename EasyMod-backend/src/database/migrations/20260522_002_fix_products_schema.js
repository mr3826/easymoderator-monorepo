'use strict';

/**
 * Migration: 20260522_002_fix_products_schema
 *
 * The squashed initial schema created `products` without the columns required
 * by the Product entity (product.entity.js).  The most critical gap is
 * `deleted_at` — the entity sets `paranoid: true`, so Sequelize appends
 * `"Product"."deleted_at" IS NULL` to EVERY query.  Without the column the
 * very first query against `products` throws SequelizeDatabaseError and the
 * unhandled rejection crashes the Node process into a restart loop, producing
 * 502 Bad Gateway from Caddy during every restart window.
 *
 * Columns added (all guarded with IF NOT EXISTS for safe re-runs):
 *
 *   deleted_at        — paranoid soft-delete (CRITICAL — crash trigger)
 *   name_bn           — Bengali product name
 *   description_bn    — Bengali description
 *   image_url         — primary image URL (entity field, separate from images[])
 *   quantity          — entity maps to this; DB had `stock` (different column)
 *   low_stock_threshold
 *   weight_unit
 *   brand
 *   aliases           — JSON array of alternate names
 *   variants          — JSON array of variant objects
 *   compare_at_price  — crossed-out "original" price
 *   cost_per_item     — merchant cost for margin calculation
 *   allow_discounts
 *   charge_tax
 *   send_low_stock_alert
 *   in_stock          — boolean stock flag used by dashboard metrics query
 *   ai_tags           — AI-generated tag array (entity default [])
 *   ai_category       — AI-inferred category string
 *   ai_color_primary  — AI-inferred dominant colour
 *   ai_material       — AI-inferred material
 *   ai_attributes     — AI-inferred structured attributes (entity default {})
 *   ai_search_text    — flattened text for full-text / similarity search
 *   ai_processed_at   — timestamp of last AI processing run
 *
 * Safe to run on any existing DB; all ALTER TABLE statements use IF NOT EXISTS.
 */

module.exports = {
    name: '20260522_002_fix_products_schema',

    up: async (sequelize) => {
        // ── CRITICAL: soft-delete column (crash trigger without this) ───────────
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);

        // ── Localisation ────────────────────────────────────────────────────────
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS name_bn VARCHAR(500);`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS description_bn TEXT;`);

        // ── Media / catalogue ───────────────────────────────────────────────────
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;`);

        // ── Inventory ───────────────────────────────────────────────────────────
        // The entity defines `quantity`; the initial schema used `stock`.
        // Both columns co-exist so old rows written via raw SQL keep their value.
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5;`);

        // ── Physical / pricing attributes ───────────────────────────────────────
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_unit VARCHAR(10) NOT NULL DEFAULT 'kg';`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price DECIMAL(10,2);`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_per_item DECIMAL(10,2);`);

        // ── Behaviour flags ──────────────────────────────────────────────────────
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_discounts BOOLEAN NOT NULL DEFAULT TRUE;`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS charge_tax BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS send_low_stock_alert BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS in_stock BOOLEAN NOT NULL DEFAULT TRUE;`);

        // ── JSON cataloguing ────────────────────────────────────────────────────
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]';`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '[]';`);

        // ── AI columns ──────────────────────────────────────────────────────────
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_tags JSONB NOT NULL DEFAULT '[]';`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_category VARCHAR(100);`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_color_primary VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_material VARCHAR(100);`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_attributes JSONB NOT NULL DEFAULT '{}';`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_search_text TEXT;`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;`);

        // ── Indexes ──────────────────────────────────────────────────────────────
        // Partial index on deleted_at NULL for fast "live" product scans
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_not_deleted ON products(shop_id) WHERE deleted_at IS NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_in_stock ON products(shop_id, in_stock) WHERE deleted_at IS NULL;`);

        console.log('[migration] 20260522_002_fix_products_schema: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS idx_products_in_stock;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_products_not_deleted;`);

        const cols = [
            'ai_processed_at', 'ai_search_text', 'ai_attributes', 'ai_material',
            'ai_color_primary', 'ai_category', 'ai_tags',
            'variants', 'aliases',
            'in_stock', 'send_low_stock_alert', 'charge_tax', 'allow_discounts',
            'cost_per_item', 'compare_at_price', 'brand', 'weight_unit',
            'low_stock_threshold', 'quantity', 'image_url',
            'description_bn', 'name_bn',
            'deleted_at'
        ];
        for (const col of cols) {
            await sequelize.query(`ALTER TABLE products DROP COLUMN IF EXISTS ${col};`);
        }

        console.log('[migration] 20260522_002_fix_products_schema: DOWN complete');
    }
};
