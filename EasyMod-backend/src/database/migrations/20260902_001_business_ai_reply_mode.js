'use strict';

/**
 * Normalize the business-level AI reply mode and demote the legacy Page fields.
 *
 * JSONB values that are not objects cannot safely receive a nested ai mode
 * without replacing the original value, so those rows are deliberately left
 * untouched. The application fails closed for them, while all valid settings
 * objects retain their unrelated data.
 *
 * shops.settings is declared JSONB in the original schema migration, but the
 * Sequelize model reads it back as DataTypes.JSON and production's actual
 * column has drifted to json — jsonb_typeof()/-> need genuine jsonb input, so
 * every read of the column is cast explicitly rather than assumed.
 */

const MIGRATION_NAME = '20260902_001_business_ai_reply_mode';
const MANUAL_MODE = 'MANUAL';
const PREVIOUS_CHANNEL_DEFAULT = 'DRAFT';

module.exports = {
    name: MIGRATION_NAME,

    up: async (sequelize) => {
        await sequelize.query(`
            UPDATE shops
               SET settings = jsonb_set(
                   COALESCE(settings::jsonb, '{}'::jsonb),
                   '{ai}',
                   (
                       CASE
                           WHEN jsonb_typeof((settings::jsonb)->'ai') = 'object'
                               THEN (settings::jsonb)->'ai'
                           ELSE '{}'::jsonb
                       END
                   ) || jsonb_build_object(
                       'automation_mode',
                       to_jsonb(
                           CASE btrim(settings #>> '{ai,automation_mode}')
                               WHEN 'AUTO' THEN 'AUTO'
                               WHEN 'AI_ACTIVE' THEN 'AUTO'
                               WHEN 'DRAFT' THEN 'DRAFT'
                               WHEN 'AI_SUGGEST_ONLY' THEN 'DRAFT'
                               WHEN 'MANUAL' THEN 'MANUAL'
                               WHEN 'HUMAN_ACTIVE' THEN 'MANUAL'
                               ELSE 'MANUAL'
                           END
                       )
                   ),
                   true
               )
             WHERE settings IS NULL
                OR (
                    jsonb_typeof(settings::jsonb) = 'object'
                    AND (
                        jsonb_typeof((settings::jsonb)->'ai') IS NULL
                        OR jsonb_typeof((settings::jsonb)->'ai') = 'object'
                        OR jsonb_typeof((settings::jsonb)->'ai') = 'null'
                    )
                    AND (
                        settings #>> '{ai,automation_mode}' IS NULL
                        OR settings #>> '{ai,automation_mode}' NOT IN ('AUTO', 'DRAFT', 'MANUAL')
                    )
                );
        `);

        await sequelize.query(`
            ALTER TABLE meta_channel_settings
            ALTER COLUMN automation_mode SET DEFAULT '${MANUAL_MODE}';
        `);

        await sequelize.query(`
            COMMENT ON COLUMN meta_channel_settings.automation_mode IS
                'DEPRECATED: legacy Page-level AI reply mode; business settings are authoritative.';
        `);

        await sequelize.query(`
            COMMENT ON COLUMN meta_channel_settings.ai_auto_reply IS
                'DEPRECATED: legacy Page-level AI reply switch; retained for compatibility and not read at runtime.';
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_channel_settings
            ALTER COLUMN automation_mode SET DEFAULT '${PREVIOUS_CHANNEL_DEFAULT}';
        `);
    },
};
