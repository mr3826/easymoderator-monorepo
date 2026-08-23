'use strict';

/** Reconcile legacy squash columns with the current payment/variant entities. */
module.exports = {
    name: '20260823_002_reconcile_legacy_entity_drift',

    up: async (sequelize) => {
        // PaymentConfig encrypts credentials as an iv:ciphertext string. The
        // squash-era JSONB column rejects that runtime value.
        await sequelize.query(`
            DO $migration$
            DECLARE credentials_type TEXT;
            BEGIN
                SELECT data_type
                  INTO credentials_type
                  FROM information_schema.columns
                 WHERE table_schema = current_schema()
                   AND table_name = 'payment_configs'
                   AND column_name = 'credentials';

                IF credentials_type IS NOT NULL THEN
                    EXECUTE 'ALTER TABLE payment_configs ALTER COLUMN credentials DROP DEFAULT';
                END IF;

                IF credentials_type = 'jsonb' THEN
                    EXECUTE $sql$
                        ALTER TABLE payment_configs
                        ALTER COLUMN credentials TYPE TEXT
                        USING CASE
                            WHEN credentials IS NULL THEN NULL
                            WHEN jsonb_typeof(credentials) = 'string' THEN credentials #>> '{}'
                            ELSE credentials::text
                        END;
                    $sql$;
                END IF;
            END
            $migration$;
        `);
        // Legacy columns may already have been removed by the entity-shaped
        // production schema. Drop the constraints only when the columns exist.
        await sequelize.query(`
            DO $migration$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'payment_configs'
                      AND column_name = 'provider'
                ) THEN
                    EXECUTE 'ALTER TABLE payment_configs ALTER COLUMN provider DROP NOT NULL';
                END IF;
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'product_variants'
                      AND column_name = 'shop_id'
                ) THEN
                    EXECUTE 'ALTER TABLE product_variants ALTER COLUMN shop_id DROP NOT NULL';
                END IF;
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'product_variants'
                      AND column_name = 'name'
                ) THEN
                    EXECUTE 'ALTER TABLE product_variants ALTER COLUMN name DROP NOT NULL';
                END IF;
            END
            $migration$;
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`
            UPDATE payment_configs
            SET provider = COALESCE(provider, gateway, 'cod')
            WHERE provider IS NULL;
        `);
        await sequelize.query(`ALTER TABLE payment_configs ALTER COLUMN provider SET NOT NULL;`);
        await sequelize.query(`
            ALTER TABLE payment_configs
            ALTER COLUMN credentials TYPE JSONB
            USING CASE
                WHEN credentials IS NULL THEN NULL
                ELSE to_jsonb(credentials)
            END;
        `);
        await sequelize.query(`
            UPDATE product_variants pv
            SET shop_id = p.shop_id
            FROM products p
            WHERE pv.shop_id IS NULL AND pv.product_id = p.id;
        `);
        await sequelize.query(`
            UPDATE product_variants
            SET name = COALESCE(name, option_value, 'Variant')
            WHERE name IS NULL;
        `);
        await sequelize.query(`ALTER TABLE product_variants ALTER COLUMN shop_id SET NOT NULL;`);
        await sequelize.query(`ALTER TABLE product_variants ALTER COLUMN name SET NOT NULL;`);
    },
};
