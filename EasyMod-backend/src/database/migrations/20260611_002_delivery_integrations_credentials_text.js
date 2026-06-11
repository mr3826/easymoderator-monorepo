/**
 * delivery_integrations.credentials: JSONB → TEXT.
 *
 * The entity encrypts credentials (AES-256-CBC) into an "iv:ciphertext"
 * string, which is not valid JSON — every INSERT/UPDATE against the original
 * JSONB column failed with "invalid input syntax for type json", so
 * POST /shop/delivery/connect 500'd and no courier was ever connectable.
 * Table is empty in prod, so the type change carries no data risk; the
 * USING cast keeps it safe regardless.
 */

module.exports = {
    name: '20260611_002_delivery_integrations_credentials_text',

    up: async (sequelize) => {
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'delivery_integrations'
                      AND column_name = 'credentials'
                      AND data_type = 'jsonb'
                ) THEN
                    ALTER TABLE delivery_integrations ALTER COLUMN credentials DROP DEFAULT;
                    ALTER TABLE delivery_integrations ALTER COLUMN credentials TYPE TEXT USING credentials::text;
                END IF;
            END $$;
        `);
    },

    down: async (sequelize) => {
        // to_jsonb() wraps the encrypted string as a JSON string, so the cast
        // back never fails even with rows present.
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'delivery_integrations'
                      AND column_name = 'credentials'
                      AND data_type = 'text'
                ) THEN
                    ALTER TABLE delivery_integrations ALTER COLUMN credentials TYPE JSONB
                        USING CASE WHEN credentials IS NULL THEN NULL ELSE to_jsonb(credentials) END;
                    ALTER TABLE delivery_integrations ALTER COLUMN credentials SET DEFAULT '{}'::jsonb;
                END IF;
            END $$;
        `);
    }
};
