'use strict';

/**
 * Make provider delivery and review state explicit on existing Message rows.
 * The legacy global external_id uniqueness is removed because provider IDs are
 * only meaningful within the owning shop/Page conversation boundary.
 */
module.exports = {
    name: '20260904_001_inbox_message_delivery_state',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE customers
                ADD COLUMN IF NOT EXISTS meta_channel_id UUID
                REFERENCES meta_channels(id) ON DELETE SET NULL;
        `);
        await sequelize.query('DROP INDEX IF EXISTS idx_customers_shop_channel;');
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_shop_channel_page
                ON customers(shop_id, channel_type, meta_channel_id, channel_user_id)
                WHERE meta_channel_id IS NOT NULL;
        `);

        await sequelize.query(`
            ALTER TABLE messages
                ADD COLUMN IF NOT EXISTS delivery_state VARCHAR(32),
                ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255),
                ADD COLUMN IF NOT EXISTS delivery_source VARCHAR(32),
                ADD COLUMN IF NOT EXISTS send_idempotency_key VARCHAR(128);
        `);

        // Existing JSON metadata is the only source for pre-hotfix rows. These
        // backfills preserve the old data while making the projection explicit.
        await sequelize.query(`
            UPDATE messages
               SET delivery_state = CASE
                   WHEN (metadata::jsonb ->> 'delivered') = 'true'
                         AND NULLIF(metadata::jsonb ->> 'provider_message_id', '') IS NOT NULL THEN 'SENT'
                   WHEN (metadata::jsonb ->> 'delivered') = 'true' THEN 'HELD'
                   WHEN (metadata::jsonb ->> 'delivery_status') = 'pending' THEN 'SEND_PENDING'
                   WHEN (metadata::jsonb ->> 'delivered') = 'false'
                        AND (metadata::jsonb ->> 'held_reason') = 'draft_mode' THEN 'DRAFT_READY'
                   WHEN (metadata::jsonb ->> 'delivered') = 'false' THEN 'HELD'
                   ELSE delivery_state
               END,
                   provider_message_id = COALESCE(
                       provider_message_id,
                       metadata::jsonb ->> 'provider_message_id'
                   )
             WHERE delivery_state IS NULL
                OR provider_message_id IS NULL;
        `);

        // The initial schema declared provider IDs and webhook dedupe keys UNIQUE
        // globally. Both are only meaningful inside the owning Page boundary.
        // Drop common constraint/index names so an existing deployment is safe
        // even when Sequelize or the bootstrap migration chose a different name.
        await sequelize.query('ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_external_id_key;');
        await sequelize.query('ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_external_id_unique;');
        await sequelize.query('DROP INDEX IF EXISTS messages_external_id_key;');
        await sequelize.query('DROP INDEX IF EXISTS messages_external_id_unique;');
        await sequelize.query('DROP INDEX IF EXISTS messages_external_id;');

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_external_id
                ON messages(external_id)
                WHERE external_id IS NOT NULL;
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_delivery_state
                ON messages(conversation_id, delivery_state);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_provider_message_id
                ON messages(provider_message_id)
                WHERE provider_message_id IS NOT NULL;
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_send_idempotency
                ON messages(conversation_id, send_idempotency_key)
                WHERE send_idempotency_key IS NOT NULL;
        `);

        await sequelize.query('ALTER TABLE meta_webhook_receipts DROP CONSTRAINT IF EXISTS meta_webhook_receipts_dedupe_key_key;');
        await sequelize.query('DROP INDEX IF EXISTS meta_webhook_receipts_dedupe_key_key;');
        await sequelize.query('DROP INDEX IF EXISTS meta_webhook_receipts_dedupe_key;');
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_webhook_receipts_page_dedupe
                ON meta_webhook_receipts(page_id, dedupe_key);
        `);

        // Some production snapshots have the migration ledger entry for the
        // missing-table repair but still lack order_sessions. Make this forward
        // migration safe for that state instead of assuming the table exists.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_sessions (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id         UUID REFERENCES customers(id) ON DELETE CASCADE,
                conversation_id     UUID,
                session_data        JSONB NOT NULL DEFAULT '{}',
                step                VARCHAR(100),
                is_active           BOOLEAN NOT NULL DEFAULT TRUE,
                expires_at          TIMESTAMPTZ,
                completed_at        TIMESTAMPTZ,
                order_id            UUID REFERENCES orders(id) ON DELETE SET NULL,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                customer_channel_id VARCHAR(255),
                channel             VARCHAR(20) DEFAULT 'messenger',
                current_step        VARCHAR(50) DEFAULT 'INITIAL',
                step_data           JSONB DEFAULT '{}',
                product_info        JSONB,
                status              VARCHAR(20) DEFAULT 'ACTIVE',
                automation_mode    VARCHAR(20) DEFAULT 'DRAFT',
                confidence_threshold INTEGER DEFAULT 60,
                last_activity_at   TIMESTAMPTZ DEFAULT NOW(),
                created_order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
                final_summary       TEXT,
                metadata            JSONB DEFAULT '{}'
            );
        `);
        await sequelize.query('ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS meta_channel_id UUID;');
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_order_sessions_shop_customer_page
                ON order_sessions(shop_id, customer_channel_id, meta_channel_id);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP INDEX IF EXISTS idx_meta_webhook_receipts_page_dedupe;');
        await sequelize.query('DROP INDEX IF EXISTS idx_order_sessions_shop_customer_page;');
        await sequelize.query('ALTER TABLE IF EXISTS order_sessions DROP COLUMN IF EXISTS meta_channel_id;');
        await sequelize.query('DROP INDEX IF EXISTS idx_messages_conversation_send_idempotency;');
        await sequelize.query('DROP INDEX IF EXISTS idx_messages_conversation_delivery_state;');
        await sequelize.query('DROP INDEX IF EXISTS idx_messages_provider_message_id;');
        await sequelize.query('DROP INDEX IF EXISTS idx_messages_external_id;');
        await sequelize.query('ALTER TABLE messages DROP COLUMN IF EXISTS send_idempotency_key;');
        await sequelize.query('ALTER TABLE messages DROP COLUMN IF EXISTS delivery_source;');
        await sequelize.query('ALTER TABLE messages DROP COLUMN IF EXISTS provider_message_id;');
        await sequelize.query('ALTER TABLE messages DROP COLUMN IF EXISTS delivery_state;');
        await sequelize.query('DROP INDEX IF EXISTS idx_customers_shop_channel_page;');
        await sequelize.query('ALTER TABLE customers DROP COLUMN IF EXISTS meta_channel_id;');
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customers_shop_channel
                ON customers(shop_id, channel_type, channel_user_id);
        `);
        // Do not restore the unsafe global external_id constraint on rollback.
        // The application-level deduplication is intentionally tenant-scoped.
    },
};
