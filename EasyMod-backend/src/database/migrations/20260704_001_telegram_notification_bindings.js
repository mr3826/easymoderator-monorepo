'use strict';

module.exports = {
    name: '20260704_001_telegram_notification_bindings',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS telegram_notification_bindings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                telegram_chat_id TEXT,
                chat_title VARCHAR(255),
                chat_type VARCHAR(50),
                status VARCHAR(20) NOT NULL DEFAULT 'disconnected',
                enabled BOOLEAN NOT NULL DEFAULT FALSE,
                preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
                connect_token_hash VARCHAR(128),
                connection_expires_at TIMESTAMPTZ,
                last_error TEXT,
                last_tested_at TIMESTAMPTZ,
                last_sent_at TIMESTAMPTZ,
                connected_at TIMESTAMPTZ,
                disconnected_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_bindings_shop ON telegram_notification_bindings(shop_id);`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_bindings_chat ON telegram_notification_bindings(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_telegram_bindings_status ON telegram_notification_bindings(status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_telegram_bindings_connect_hash ON telegram_notification_bindings(connect_token_hash);`);

        console.log('[migration] 20260704_001_telegram_notification_bindings: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS idx_telegram_bindings_connect_hash;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_telegram_bindings_status;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_telegram_bindings_chat;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_telegram_bindings_shop;`);
        await sequelize.query(`DROP TABLE IF EXISTS telegram_notification_bindings;`);

        console.log('[migration] 20260704_001_telegram_notification_bindings: DOWN complete');
    }
};
