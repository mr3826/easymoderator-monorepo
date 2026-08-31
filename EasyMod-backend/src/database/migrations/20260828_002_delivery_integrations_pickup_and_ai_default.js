'use strict';

/** Add provider pickup selection and an explicit AI default flag. */
module.exports = {
    name: '20260828_002_delivery_integrations_pickup_and_ai_default',

    up: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';

        if (dialect === 'postgres') {
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS pickup_location_id UUID
                    REFERENCES shop_pickup_locations(id) ON DELETE SET NULL;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS pickup_store_id VARCHAR(120);
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS provider_store_id VARCHAR(120);
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS provider_pickup_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS pickup_enabled BOOLEAN NOT NULL DEFAULT FALSE;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS is_ai_default BOOLEAN NOT NULL DEFAULT FALSE;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS activation_status VARCHAR(30) NOT NULL DEFAULT 'NOT_CONFIGURED';
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS activation_error TEXT;
            `);
            await sequelize.query(`
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'delivery_integrations_ai_default_active_check'
                    ) THEN
                        ALTER TABLE delivery_integrations
                        ADD CONSTRAINT delivery_integrations_ai_default_active_check
                        CHECK (NOT is_ai_default OR (is_active AND is_connected));
                    END IF;
                END $$;
            `);
        } else {
            const result = await sequelize.query("PRAGMA table_info('delivery_integrations')");
            const columns = Array.isArray(result?.[0]) ? result[0] : [];
            const hasColumn = (name) => columns.some((column) => column.name === name);

            if (!hasColumn('pickup_location_id')) {
                await sequelize.query(`
                    ALTER TABLE delivery_integrations
                    ADD COLUMN pickup_location_id TEXT REFERENCES shop_pickup_locations(id) ON DELETE SET NULL;
                `);
            }
            if (!hasColumn('pickup_store_id')) {
                await sequelize.query(`
                    ALTER TABLE delivery_integrations
                    ADD COLUMN pickup_store_id VARCHAR(120);
                `);
            }
            if (!hasColumn('provider_store_id')) {
                await sequelize.query(`
                    ALTER TABLE delivery_integrations
                    ADD COLUMN provider_store_id VARCHAR(120);
                `);
            }
            if (!hasColumn('provider_pickup_meta')) {
                await sequelize.query(`
                    ALTER TABLE delivery_integrations
                    ADD COLUMN provider_pickup_meta TEXT NOT NULL DEFAULT '{}';
                `);
            }
            if (!hasColumn('pickup_enabled')) {
                await sequelize.query(`
                    ALTER TABLE delivery_integrations
                    ADD COLUMN pickup_enabled BOOLEAN NOT NULL DEFAULT 0;
                `);
            }
            if (!hasColumn('is_ai_default')) {
                await sequelize.query(`
                    ALTER TABLE delivery_integrations
                    ADD COLUMN is_ai_default BOOLEAN NOT NULL DEFAULT 0;
                `);
            }
            if (!hasColumn('activation_status')) {
                await sequelize.query(`
                    ALTER TABLE delivery_integrations
                    ADD COLUMN activation_status VARCHAR(30) NOT NULL DEFAULT 'NOT_CONFIGURED';
                `);
            }
            if (!hasColumn('activation_error')) {
                await sequelize.query(`
                    ALTER TABLE delivery_integrations
                    ADD COLUMN activation_error TEXT;
                `);
            }
        }

        // Preserve the old UI-selected provider as a one-time backfill, but do
        // not allow an inactive or disconnected integration to become default.
        const [shops] = await sequelize.query('SELECT id, settings FROM shops');
        for (const shop of shops || []) {
            let settings = shop.settings;
            if (typeof settings === 'string') {
                try { settings = JSON.parse(settings); } catch (_) { settings = {}; }
            }
            const provider = settings?.delivery_platform_priority?.[0];
            if (!provider) continue;
            await sequelize.query(`
                UPDATE delivery_integrations
                SET is_ai_default = ${dialect === 'postgres' ? 'TRUE' : '1'},
                    activation_status = CASE WHEN is_active AND is_connected THEN 'ACTIVE' ELSE activation_status END
                WHERE shop_id = :shopId
                  AND provider = :provider
                  AND is_active = ${dialect === 'postgres' ? 'TRUE' : '1'}
                  AND is_connected = ${dialect === 'postgres' ? 'TRUE' : '1'}
                  AND NOT EXISTS (
                      SELECT 1
                      FROM delivery_integrations current_default
                      WHERE current_default.shop_id = :shopId
                        AND current_default.is_ai_default = ${dialect === 'postgres' ? 'TRUE' : '1'}
                  );
            `, { replacements: { shopId: shop.id, provider } });
        }

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_delivery_integrations_pickup_location
                ON delivery_integrations (shop_id, pickup_location_id);
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_integrations_one_ai_default
                ON delivery_integrations (shop_id)
                WHERE is_ai_default = TRUE;
        `);
    },

    down: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';

        await sequelize.query('DROP INDEX IF EXISTS idx_delivery_integrations_one_ai_default;');
        await sequelize.query('DROP INDEX IF EXISTS idx_delivery_integrations_pickup_location;');

        if (dialect === 'postgres') {
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS is_ai_default;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS pickup_enabled;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS provider_pickup_meta;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS pickup_store_id;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS provider_store_id;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS pickup_location_id;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS activation_error;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS activation_status;
            `);
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP CONSTRAINT IF EXISTS delivery_integrations_ai_default_active_check;
            `);
            return;
        }

        const result = await sequelize.query("PRAGMA table_info('delivery_integrations')");
        const columns = Array.isArray(result?.[0]) ? result[0] : [];
        for (const name of ['activation_error', 'activation_status', 'is_ai_default', 'pickup_enabled', 'provider_pickup_meta', 'provider_store_id', 'pickup_store_id', 'pickup_location_id']) {
            if (columns.some((column) => column.name === name)) {
                await sequelize.query(`ALTER TABLE delivery_integrations DROP COLUMN ${name};`);
            }
        }
    },
};
