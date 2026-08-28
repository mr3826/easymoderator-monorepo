'use strict';

/**
 * Durable, shop-scoped pickup locations.
 *
 * Provider stores are copied into this table as non-secret location records so
 * the delivery settings and readiness paths do not need to retain provider
 * response payloads or credentials.
 */
module.exports = {
    name: '20260828_001_shop_pickup_locations',

    up: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';
        const postgres = dialect === 'postgres';
        const uuid = postgres ? 'UUID' : 'TEXT';
        const timestamp = postgres ? 'TIMESTAMPTZ' : 'DATETIME';
        const json = postgres ? 'JSONB' : 'TEXT';
        const now = postgres ? 'NOW()' : 'CURRENT_TIMESTAMP';
        const jsonDefault = postgres ? "'{}'::jsonb" : "'{}'";
        const booleanTrue = postgres ? 'TRUE' : '1';

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS shop_pickup_locations (
                id                 ${uuid} PRIMARY KEY${postgres ? ' DEFAULT gen_random_uuid()' : ''},
                shop_id            ${uuid} NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                display_name       VARCHAR(255) NOT NULL,
                contact_name       VARCHAR(255),
                phone              VARCHAR(32),
                secondary_phone    VARCHAR(32),
                address            TEXT NOT NULL,
                city_name          VARCHAR(120),
                zone_name          VARCHAR(120),
                area_name          VARCHAR(120) NOT NULL,
                postal_code        VARCHAR(32),
                -- Legacy aliases keep the model tolerant of pre-release rows.
                name               VARCHAR(255),
                contact_phone      VARCHAR(32),
                city               VARCHAR(120),
                zone               VARCHAR(120),
                area               VARCHAR(120),
                city_id            INTEGER,
                zone_id            INTEGER,
                area_id            INTEGER,
                provider           VARCHAR(50) NOT NULL DEFAULT 'manual',
                provider_store_id  VARCHAR(120),
                is_active          BOOLEAN NOT NULL DEFAULT TRUE,
                is_default         BOOLEAN NOT NULL DEFAULT FALSE,
                metadata           ${json} NOT NULL DEFAULT ${jsonDefault},
                created_at         ${timestamp} NOT NULL DEFAULT ${now},
                updated_at         ${timestamp} NOT NULL DEFAULT ${now},
                CONSTRAINT shop_pickup_locations_provider_store_uq
                    UNIQUE (shop_id, provider, provider_store_id)
            );
        `);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_shop_pickup_locations_shop_active
                ON shop_pickup_locations (shop_id, is_active);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_shop_pickup_locations_provider_store
                ON shop_pickup_locations (shop_id, provider, provider_store_id);
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_pickup_locations_one_default
                ON shop_pickup_locations (shop_id)
                WHERE is_default = ${booleanTrue};
        `);
        if (postgres) {
            await sequelize.query(`
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'shop_pickup_locations_default_active_check'
                    ) THEN
                        ALTER TABLE shop_pickup_locations
                        ADD CONSTRAINT shop_pickup_locations_default_active_check
                        CHECK (NOT is_default OR is_active);
                    END IF;
                END $$;
            `);
        }
    },

    down: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';

        await sequelize.query('DROP INDEX IF EXISTS idx_shop_pickup_locations_one_default;');
        await sequelize.query('DROP INDEX IF EXISTS idx_shop_pickup_locations_provider_store;');
        await sequelize.query('DROP INDEX IF EXISTS idx_shop_pickup_locations_shop_active;');
        await sequelize.query(
            dialect === 'postgres'
                ? 'DROP TABLE IF EXISTS shop_pickup_locations CASCADE;'
                : 'DROP TABLE IF EXISTS shop_pickup_locations;'
        );
    },
};
