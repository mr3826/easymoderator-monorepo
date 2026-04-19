'use strict';

/**
 * Add AI analysis columns to products table.
 *
 * ai_* columns = generated at upload time by vision LLM (for search/identification only)
 * These are NEVER shown directly to customers — live fields (price, quantity, etc.)
 * are always fetched fresh from the DB at query time.
 */
module.exports = {
    name: '20260320_003_add_product_ai_columns',

    up: async (sequelize) => {
        const { DataTypes } = require('sequelize');
        const queryInterface = sequelize.getQueryInterface();
        const dialect = sequelize.getDialect();
        const tableDesc = await queryInterface.describeTable('products');

        const addIfMissing = async (col, def) => {
            if (!tableDesc[col]) {
                await queryInterface.addColumn('products', col, def);
            }
        };

        await addIfMissing('ai_description', {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'LLM-generated product description for search (set once at upload)'
        });

        if (!tableDesc['ai_tags']) {
            await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_tags ${dialect === 'postgres' ? 'JSONB' : 'TEXT'} NOT NULL DEFAULT '[]'`);
        }

        await addIfMissing('ai_category', {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Normalised product category from vision LLM'
        });

        await addIfMissing('ai_color_primary', {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Primary colour detected from product image'
        });

        await addIfMissing('ai_material', {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Material / fabric detected from product image'
        });

        if (!tableDesc['ai_attributes']) {
            await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_attributes ${dialect === 'postgres' ? 'JSONB' : 'TEXT'} NOT NULL DEFAULT '{}'`);
        }

        await addIfMissing('ai_search_text', {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Concatenated text used for full-text search indexing'
        });

        await addIfMissing('ai_processed_at', {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp when vision LLM last processed this product'
        });

        if (dialect === 'postgres') {
            // PostgreSQL: Full-text search index with GIN
            await sequelize.query(`
                CREATE INDEX CONCURRENTLY IF NOT EXISTS products_ai_search_idx
                ON products
                USING GIN (
                    to_tsvector('english',
                        coalesce(name, '') || ' ' ||
                        coalesce(ai_search_text, '') || ' ' ||
                        coalesce(ai_category, '') || ' ' ||
                        coalesce(ai_color_primary, '') || ' ' ||
                        coalesce(ai_material, '') || ' ' ||
                        coalesce(category, '')
                    )
                )
                WHERE deleted_at IS NULL;
            `).catch(() => {
                // If CONCURRENTLY fails (inside a transaction), fall back
                return sequelize.query(`
                    CREATE INDEX IF NOT EXISTS products_ai_search_idx
                    ON products
                    USING GIN (
                        to_tsvector('english',
                            coalesce(name, '') || ' ' ||
                            coalesce(ai_search_text, '') || ' ' ||
                            coalesce(ai_category, '') || ' ' ||
                            coalesce(ai_color_primary, '') || ' ' ||
                            coalesce(category, '')
                        )
                    )
                    WHERE deleted_at IS NULL;
                `);
            });

            // Ensure ai_tags is JSONB (may be JSON if column was created by Sequelize sync)
            await sequelize.query(`
                ALTER TABLE products
                ALTER COLUMN ai_tags TYPE JSONB USING ai_tags::text::jsonb;
            `).catch(() => {}); // no-op if already JSONB

            // Index on ai_tags for tag-based search
            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS products_ai_tags_idx
                ON products USING GIN (ai_tags jsonb_path_ops)
                WHERE deleted_at IS NULL;
            `).catch(async () => {
                // Fallback without partial index if column still isn't JSONB
                await sequelize.query(`
                    CREATE INDEX IF NOT EXISTS products_ai_tags_idx
                    ON products USING GIN (ai_tags);
                `).catch(() => {}); // skip entirely if still failing
            });
        } else {
            // SQLite: Simple FTS index (basic text search)
            try {
                await sequelize.query(`
                    CREATE INDEX IF NOT EXISTS products_ai_search_idx
                    ON products (name, ai_search_text, ai_category, ai_color_primary, ai_material)
                    WHERE deleted_at IS NULL;
                `);
            } catch (err) {
                // Fallback for SQLite without WHERE clause support
                await sequelize.query(`
                    CREATE INDEX IF NOT EXISTS products_ai_search_idx
                    ON products (name, ai_search_text, ai_category, ai_color_primary, ai_material)
                `);
            }

            // Simple index on ai_tags (SQLite doesn't support GIN)
            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS products_ai_tags_idx
                ON products (ai_tags)
            `);
        }

        // Index for unprocessed products (background job) - works on both
        try {
            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS products_ai_pending_idx
                ON products (shop_id, ai_processed_at)
                ${dialect === 'postgres' ? 'WHERE deleted_at IS NULL AND ai_processed_at IS NULL;' : ''}
            `);
        } catch (err) {
            // Fallback for SQLite without WHERE clause
            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS products_ai_pending_idx
                ON products (shop_id, ai_processed_at)
            `);
        }
    },

    down: async (sequelize) => {
        const queryInterface = sequelize.getQueryInterface();

        await sequelize.query('DROP INDEX IF EXISTS products_ai_search_idx;');
        await sequelize.query('DROP INDEX IF EXISTS products_ai_tags_idx;');
        await sequelize.query('DROP INDEX IF EXISTS products_ai_pending_idx;');

        for (const col of ['ai_description', 'ai_tags', 'ai_category', 'ai_color_primary',
            'ai_material', 'ai_attributes', 'ai_search_text', 'ai_processed_at']) {
            await queryInterface.removeColumn('products', col).catch(() => {});
        }
    }
};
