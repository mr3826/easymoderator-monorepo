'use strict';

module.exports = {
    name: '20260904_002_inbox_delivery_outbox',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS inbox_delivery_outbox (
                id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id            UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                message_id         UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                delivery_source    VARCHAR(32) NOT NULL DEFAULT 'DRAFT_APPROVAL',
                status             VARCHAR(32) NOT NULL DEFAULT 'PENDING',
                attempt_count      INTEGER NOT NULL DEFAULT 0,
                next_attempt_at    TIMESTAMPTZ DEFAULT NOW(),
                processing_token   VARCHAR(64),
                provider_message_id VARCHAR(255),
                last_error_code    VARCHAR(64),
                created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`
            ALTER TABLE inbox_delivery_outbox
                ALTER COLUMN next_attempt_at DROP NOT NULL;
        `);
        await sequelize.query(`
            ALTER TABLE inbox_delivery_outbox
                ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255);
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_delivery_outbox_message
                ON inbox_delivery_outbox(message_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_inbox_delivery_outbox_due
                ON inbox_delivery_outbox(status, next_attempt_at);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_inbox_delivery_outbox_shop_status
                ON inbox_delivery_outbox(shop_id, status);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP TABLE IF EXISTS inbox_delivery_outbox;');
    },
};
