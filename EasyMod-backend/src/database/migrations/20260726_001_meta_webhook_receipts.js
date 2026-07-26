'use strict';

/**
 * Durable inbound Meta webhook receipts (F-02 / F-03).
 *
 * Before this table existed an unmapped Page or a failed message INSERT was
 * logged and dropped while Meta was told 200 — the event then existed nowhere.
 */
module.exports = {
    name: '20260726_001_meta_webhook_receipts',

    up: async (sequelize) => {
        await sequelize.query(`
            DO $$ BEGIN
                CREATE TYPE enum_meta_webhook_receipts_status
                    AS ENUM (
                        'RECEIVED',
                        'PROCESSING',
                        'QUEUED',
                        'PROCESSED',
                        'SKIPPED',
                        'IDENTITY_NOT_RESOLVED',
                        'MESSAGE_STORE_FAILED',
                        'RETRY_PENDING',
                        'DEAD_LETTERED'
                    );
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
        `);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS meta_webhook_receipts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider VARCHAR(32) NOT NULL DEFAULT 'meta',
                object_type VARCHAR(32) NOT NULL DEFAULT 'page',
                page_id VARCHAR(128) NOT NULL,
                event_id VARCHAR(191),
                dedupe_key VARCHAR(191) NOT NULL UNIQUE,
                event_type VARCHAR(32) NOT NULL DEFAULT 'unknown',
                sender_ref VARCHAR(64),
                payload_hash VARCHAR(64) NOT NULL,
                payload_encrypted TEXT,
                shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
                meta_channel_id UUID REFERENCES meta_channels(id) ON DELETE SET NULL,
                status enum_meta_webhook_receipts_status NOT NULL DEFAULT 'RECEIVED',
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_error_code VARCHAR(64),
                next_retry_at TIMESTAMPTZ,
                processing_token VARCHAR(64),
                received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                processed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_webhook_receipts_status_retry
            ON meta_webhook_receipts(status, next_retry_at);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_webhook_receipts_page_received
            ON meta_webhook_receipts(page_id, received_at);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_webhook_receipts_shop
            ON meta_webhook_receipts(shop_id);
        `);

        console.log('[migration] 20260726_001_meta_webhook_receipts: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query('DROP TABLE IF EXISTS meta_webhook_receipts;');
        await sequelize.query('DROP TYPE IF EXISTS enum_meta_webhook_receipts_status;');
        console.log('[migration] 20260726_001_meta_webhook_receipts: DOWN complete');
    },
};
