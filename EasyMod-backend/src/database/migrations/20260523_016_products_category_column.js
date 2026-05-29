'use strict';

/**
 * Migration: 20260523_016_products_category_column
 *
 * Restores the `products.category` VARCHAR(100) column that the squash
 * (20260520_000_initial_schema) dropped. The Sequelize entity at
 * src/modules/product/product.entity.js still declares `category`, and
 * raw SQL paths in product-search.service.js select `p.category`, so any
 * GET /api/product (which calls Product.findAll() with default attributes)
 * 500s with `column Product.category does not exist`.
 *
 * The column is independent of the `category_id` FK to categories — both
 * exist by design: category_id is the relational link, while `category`
 * is a free-text label used by the AI ingestion / embedding pipeline
 * (product-ai.service.js writes it from vision LLM output; product-search
 * uses it for ILIKE attribute matching alongside ai_category).
 */

module.exports = {
    name: '20260523_016_products_category_column',

    up: async (sequelize) => {
        await sequelize.query(
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(100);`
        );
        console.log('[migration] 20260523_016_products_category_column: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(
            `ALTER TABLE products DROP COLUMN IF EXISTS category;`
        );
        console.log('[migration] 20260523_016_products_category_column: DOWN complete');
    }
};
