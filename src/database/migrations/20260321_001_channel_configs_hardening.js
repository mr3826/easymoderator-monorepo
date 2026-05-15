'use strict';

/**
 * Migration: Channel configs hardening
 *
 * 1. Add token_expires_at column — tracks Meta System User token expiry
 *    so the frontend can warn operators before the token lapses.
 * 2. Add UNIQUE(shop_id, channel_type) constraint if it doesn't exist —
 *    enforces one channel per type per shop at the DB level.
 */

module.exports = {
    name: '20260321_001_channel_configs_hardening',

    up: async (sequelize) => {
        const queryInterface = sequelize.getQueryInterface();
        const dialect = sequelize.getDialect();

        if (dialect !== 'postgres') return;

        // 1. Add token_expires_at (idempotent)
        await queryInterface.sequelize.query(`
            ALTER TABLE channel_configs
            ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ NULL;
        `);

        // 3. Relax page_id NOT NULL — some channel types (WhatsApp via Business Manager ID)
        //    don't have a page_id so the fallback 'system-user' string was misleading.
        await queryInterface.sequelize.query(`
            ALTER TABLE channel_configs
            ALTER COLUMN page_id DROP NOT NULL;
        `);

        // 2. Add unique constraint (idempotent)
        await queryInterface.sequelize.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM   pg_constraint c
                    JOIN   pg_class t ON t.oid = c.conrelid
                    WHERE  t.relname = 'channel_configs'
                      AND  c.contype = 'u'
                      AND  c.conname = 'channel_configs_shop_id_channel_type_key'
                ) THEN
                    ALTER TABLE channel_configs
                    ADD CONSTRAINT channel_configs_shop_id_channel_type_key
                    UNIQUE (shop_id, channel_type);
                END IF;
            END
            $$;
        `);
    },

    down: async (sequelize) => {
        const queryInterface = sequelize.getQueryInterface();
        const dialect = sequelize.getDialect();

        if (dialect !== 'postgres') return;

        await queryInterface.sequelize.query(`
            ALTER TABLE channel_configs
            DROP COLUMN IF EXISTS token_expires_at;
        `);

        await queryInterface.sequelize.query(`
            ALTER TABLE channel_configs
            DROP CONSTRAINT IF EXISTS channel_configs_shop_id_channel_type_key;
        `);
    }
};
