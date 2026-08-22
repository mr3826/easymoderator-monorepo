'use strict';

/** Reconcile legacy squash columns with the current payment/variant entities. */
module.exports = {
    name: '20260823_002_reconcile_legacy_entity_drift',

    up: async (sequelize) => {
        // PaymentConfig encrypts credentials as an iv:ciphertext string. The
        // squash-era JSONB column rejects that runtime value.
        await sequelize.query(`
            ALTER TABLE payment_configs
            ALTER COLUMN credentials DROP DEFAULT;
        `);
        await sequelize.query(`
            ALTER TABLE payment_configs
            ALTER COLUMN credentials TYPE TEXT
            USING CASE
                WHEN credentials IS NULL THEN NULL
                WHEN jsonb_typeof(credentials) = 'string' THEN credentials #>> '{}'
                ELSE credentials::text
            END;
        `);
        // gateway is the current entity field; provider is retained only for
        // legacy reads and must not block current inserts.
        await sequelize.query(`ALTER TABLE payment_configs ALTER COLUMN provider DROP NOT NULL;`);

        // ProductVariant derives shop ownership from its Product association and
        // uses option_name/option_value instead of the old name/shop_id fields.
        await sequelize.query(`ALTER TABLE product_variants ALTER COLUMN shop_id DROP NOT NULL;`);
        await sequelize.query(`ALTER TABLE product_variants ALTER COLUMN name DROP NOT NULL;`);
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
