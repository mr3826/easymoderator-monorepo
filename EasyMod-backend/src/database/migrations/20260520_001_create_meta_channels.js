/**
 * Migration: 20260520_001_create_meta_channels
 *
 * Phase 1 — Foundations: unified schema
 *
 * Creates:
 *   - meta_channels          (main channel table, replaces channel_configs + meta_integrations)
 *   - meta_channel_settings  (1:1 per-channel config, replaces channel_configs.settings JSON blob)
 *   - meta_channel_consent_events (append-only consent audit trail)
 *
 * Adds:
 *   - customers.messaging_consent JSONB column (per-channel opt-in/opt-out tracking)
 *
 * Backfills:
 *   - meta_channels from meta_integrations (dual-write source of truth during Phase 1-2)
 *   - meta_channel_settings from channel_configs.settings JSON where channel_type matches platform
 *
 * NOTE: The existing meta_integrations and channel_configs tables are NOT touched.
 *       They continue operating in parallel until Phase 5 cutover.
 *       Tokens in meta_integrations.access_token are already in the legacy AES-256-GCM format
 *       (iv:authTag:ct) which meta-token-cipher.decrypt() supports for backward compatibility.
 *
 * Indexes:
 *   UNIQUE(shop_id, platform), UNIQUE(meta_asset_id), UNIQUE(webhook_verify_token),
 *   INDEX(status), INDEX(token_expires_at)
 */

'use strict';

module.exports = {
    name: '20260520_001_create_meta_channels',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') {
            console.warn('[migration] 20260520_001 skipped — requires PostgreSQL');
            return;
        }

        // ── 1. Create ENUM types ────────────────────────────────────────────────
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_meta_channels_platform') THEN
                    CREATE TYPE enum_meta_channels_platform AS ENUM ('facebook', 'instagram');
                END IF;
            END $$;
        `);

        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_meta_channels_status') THEN
                    CREATE TYPE enum_meta_channels_status AS ENUM (
                        'CONNECTED', 'TOKEN_EXPIRED', 'REVOKED', 'DISCONNECTED', 'ERROR'
                    );
                END IF;
            END $$;
        `);

        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_meta_channel_settings_automation_mode') THEN
                    CREATE TYPE enum_meta_channel_settings_automation_mode AS ENUM (
                        'AI_ACTIVE', 'AI_SUGGEST_ONLY', 'HUMAN_ACTIVE', 'MANUAL', 'DRAFT'
                    );
                END IF;
            END $$;
        `);

        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_meta_channel_consent_events_event') THEN
                    CREATE TYPE enum_meta_channel_consent_events_event AS ENUM (
                        'OPT_IN_IMPLICIT', 'OPT_IN_EXPLICIT', 'OPT_OUT', 'DEAUTHORIZED', 'DATA_DELETED'
                    );
                END IF;
            END $$;
        `);

        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_meta_channel_consent_events_source') THEN
                    CREATE TYPE enum_meta_channel_consent_events_source AS ENUM (
                        'webhook_messaging_optins', 'message', 'keyword_stop', 'admin', 'meta_callback'
                    );
                END IF;
            END $$;
        `);

        // ── 2. Create meta_channels ─────────────────────────────────────────────
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS meta_channels (
                id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id                     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                platform                    enum_meta_channels_platform NOT NULL,
                meta_asset_id               VARCHAR(64) NOT NULL,
                display_name                VARCHAR(255) NOT NULL,
                picture_url                 TEXT,
                linked_fb_page_id           VARCHAR(64),
                page_access_token_ct        TEXT,
                token_expires_at            TIMESTAMPTZ,
                token_last_refreshed_at     TIMESTAMPTZ,
                token_refresh_attempts      INT NOT NULL DEFAULT 0,
                webhook_verify_token        VARCHAR(64) UNIQUE,
                webhook_subscribed_fields   JSONB DEFAULT '[]',
                webhook_last_verified_at    TIMESTAMPTZ,
                status                      enum_meta_channels_status NOT NULL DEFAULT 'CONNECTED',
                last_error                  TEXT,
                connected_by_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
                connected_at                TIMESTAMPTZ,
                disconnected_at             TIMESTAMPTZ,
                created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unique_meta_channel_shop_platform
                ON meta_channels (shop_id, platform);
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unique_meta_channel_asset_id
                ON meta_channels (meta_asset_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_channel_status
                ON meta_channels (status);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_channel_token_expires_at
                ON meta_channels (token_expires_at);
        `);

        // ── 3. Create meta_channel_settings ────────────────────────────────────
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS meta_channel_settings (
                channel_id                  UUID PRIMARY KEY REFERENCES meta_channels(id) ON DELETE CASCADE,
                ai_auto_reply               BOOLEAN NOT NULL DEFAULT TRUE,
                automation_mode             enum_meta_channel_settings_automation_mode NOT NULL DEFAULT 'AI_ACTIVE',
                confidence_threshold_send   DECIMAL(3,2) NOT NULL DEFAULT 0.75,
                confidence_threshold_suggest DECIMAL(3,2) NOT NULL DEFAULT 0.50,
                business_hours              JSONB,
                allow_order_creation        BOOLEAN NOT NULL DEFAULT TRUE,
                comment_to_dm_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
                comment_to_dm_post_filter   JSONB NOT NULL DEFAULT '[]',
                comment_to_dm_keywords      JSONB NOT NULL DEFAULT '[]',
                created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        // ── 4. Create meta_channel_consent_events ───────────────────────────────
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS meta_channel_consent_events (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL,
                channel_id  UUID NOT NULL REFERENCES meta_channels(id) ON DELETE CASCADE,
                customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
                event       enum_meta_channel_consent_events_event NOT NULL,
                source      enum_meta_channel_consent_events_source NOT NULL,
                metadata    JSONB,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_consent_shop_customer
                ON meta_channel_consent_events (shop_id, customer_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_consent_channel
                ON meta_channel_consent_events (channel_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_consent_customer_event
                ON meta_channel_consent_events (customer_id, event);
        `);

        // ── 5. Add customers.messaging_consent ─────────────────────────────────
        await sequelize.query(`
            ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS messaging_consent JSONB NOT NULL DEFAULT '{}';
        `);

        // ── 6. Backfill meta_channels from meta_integrations ───────────────────
        // Only backfill rows for platforms we support (facebook, instagram).
        // Tokens from meta_integrations.access_token are in legacy AES-256-GCM format
        // (iv:authTag:ct) — meta-token-cipher.decrypt() reads this without modification.
        // We copy the raw ciphertext value unchanged; it will be re-encrypted in v2 format
        // the next time the token is refreshed (Phase 2 token refresh cron).
        await sequelize.query(`
            INSERT INTO meta_channels (
                id,
                shop_id,
                platform,
                meta_asset_id,
                display_name,
                page_access_token_ct,
                token_expires_at,
                webhook_verify_token,
                status,
                connected_at,
                created_at,
                updated_at
            )
            SELECT
                gen_random_uuid(),
                mi.shop_id,
                mi.platform::enum_meta_channels_platform,
                mi.meta_asset_id,
                mi.display_name,
                mi.access_token,       -- legacy iv:authTag:ct format, readable by cipher
                mi.token_expires_at,
                mi.webhook_verify_token,
                CASE
                    WHEN mi.status = 'CONNECTED'    THEN 'CONNECTED'::enum_meta_channels_status
                    WHEN mi.status = 'DISCONNECTED' THEN 'DISCONNECTED'::enum_meta_channels_status
                    ELSE 'ERROR'::enum_meta_channels_status
                END,
                mi.connected_at,
                mi.created_at,
                mi.updated_at
            FROM meta_integrations mi
            WHERE mi.platform IN ('facebook', 'instagram')
              AND mi.meta_asset_id IS NOT NULL
            ON CONFLICT (shop_id, platform) DO NOTHING;
        `);

        console.log('[migration] Backfilled meta_channels from meta_integrations');

        // ── 7. Backfill meta_channel_settings from channel_configs.settings ────
        // Match channel_configs rows to meta_channels by shop_id + platform equivalent.
        // channel_configs.channel_type uses 'messenger' for Facebook, 'instagram' for IG.
        await sequelize.query(`
            INSERT INTO meta_channel_settings (
                channel_id,
                ai_auto_reply,
                automation_mode,
                allow_order_creation,
                comment_to_dm_enabled,
                created_at,
                updated_at
            )
            SELECT
                mc.id,
                COALESCE((cc.settings->>'ai_auto_reply')::boolean, TRUE),
                COALESCE(
                    (cc.settings->>'automation_mode')::enum_meta_channel_settings_automation_mode,
                    'AI_ACTIVE'::enum_meta_channel_settings_automation_mode
                ),
                COALESCE((cc.settings->>'allow_order_creation')::boolean, TRUE),
                COALESCE((cc.settings->>'comment_to_dm_enabled')::boolean, FALSE),
                NOW(),
                NOW()
            FROM meta_channels mc
            JOIN channel_configs cc ON (
                cc.shop_id = mc.shop_id
                AND (
                    (mc.platform = 'facebook'  AND cc.channel_type IN ('messenger', 'facebook'))
                    OR (mc.platform = 'instagram' AND cc.channel_type = 'instagram')
                )
            )
            ON CONFLICT (channel_id) DO NOTHING;
        `);

        // Insert default settings for any meta_channels without a matching channel_config
        await sequelize.query(`
            INSERT INTO meta_channel_settings (channel_id, created_at, updated_at)
            SELECT mc.id, NOW(), NOW()
            FROM meta_channels mc
            WHERE NOT EXISTS (
                SELECT 1 FROM meta_channel_settings mcs WHERE mcs.channel_id = mc.id
            )
            ON CONFLICT (channel_id) DO NOTHING;
        `);

        console.log('[migration] Backfilled meta_channel_settings from channel_configs');
        console.log('[migration] 20260520_001_create_meta_channels: UP complete');
    },

    down: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') return;

        // Reverse in dependency order
        await sequelize.query(`ALTER TABLE customers DROP COLUMN IF EXISTS messaging_consent;`);
        await sequelize.query(`DROP TABLE IF EXISTS meta_channel_consent_events;`);
        await sequelize.query(`DROP TABLE IF EXISTS meta_channel_settings;`);
        await sequelize.query(`DROP TABLE IF EXISTS meta_channels;`);

        await sequelize.query(`DROP TYPE IF EXISTS enum_meta_channel_consent_events_source;`);
        await sequelize.query(`DROP TYPE IF EXISTS enum_meta_channel_consent_events_event;`);
        await sequelize.query(`DROP TYPE IF EXISTS enum_meta_channel_settings_automation_mode;`);
        await sequelize.query(`DROP TYPE IF EXISTS enum_meta_channels_status;`);
        await sequelize.query(`DROP TYPE IF EXISTS enum_meta_channels_platform;`);

        console.log('[migration] 20260520_001_create_meta_channels: DOWN complete');
    }
};
