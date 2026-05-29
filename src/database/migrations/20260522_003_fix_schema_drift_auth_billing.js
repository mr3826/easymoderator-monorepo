'use strict';

/**
 * Migration: 20260522_003_fix_schema_drift_auth_billing
 *
 * Domain: Auth, Billing, Payment
 *
 * Entities covered:
 *   - Session           → entity uses tableName 'user_sessions'; squash only
 *                         created 'sessions'.  Create the correct table.
 *   - PasswordResetToken→ squash has 'token'/'used'; entity uses 'token_hash'/'used_at'.
 *   - Subscription      → missing billing_model, per_order_charge_bdt, partner_*,
 *                         extra_conversations, extra_charge.
 *   - Invoice (billing) → status column is VARCHAR in squash, but Invoice entity
 *                         needs VARCHAR; no structural crash.  Skip — type-only.
 *   - PaymentConfig     → squash column is 'provider'/'is_active'; entity uses
 *                         'gateway'/'is_enabled'.  Add entity columns.
 *   - TrxIDLog          → squash has 'gateway'/'screenshot_url'/'status'; entity uses
 *                         'mfs_type'/'sender_phone'/'receiver_phone'/'ocr_raw'.
 *   - IdempotencyKey    → squash column 'key' vs entity column 'idempotency_key';
 *                         missing 'endpoint', 'method', 'request_hash', 'response_data'.
 *
 * Strategy:
 *   All ADD COLUMN statements use IF NOT EXISTS (Postgres 9.6+).
 *   No existing column is dropped or renamed — backward-compatible.
 *   The 'user_sessions' table is created with IF NOT EXISTS so a fresh DB that
 *   already ran db:sync will not fail.
 */

module.exports = {
    name: '20260522_003_fix_schema_drift_auth_billing',

    up: async (sequelize) => {

        // ── 1. user_sessions ────────────────────────────────────────────────────
        // Session entity uses tableName 'user_sessions'. Squash created 'sessions'.
        // We create the proper table; 'sessions' is kept for backward compat.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                shop_id             UUID REFERENCES shops(id) ON DELETE CASCADE,
                session_token       VARCHAR(255) NOT NULL,
                device_fingerprint  TEXT,
                user_agent          TEXT,
                ip_address          INET,
                location            JSONB,
                is_active           BOOLEAN NOT NULL DEFAULT TRUE,
                expires_at          TIMESTAMPTZ NOT NULL,
                last_activity_at    TIMESTAMPTZ,
                metadata            JSONB,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(user_id, session_token)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active);`);

        // ── 2. password_reset_tokens ─────────────────────────────────────────────
        // Squash: token TEXT UNIQUE, used BOOLEAN
        // Entity:  token_hash VARCHAR(64) UNIQUE, used_at DATE nullable
        await sequelize.query(`ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);`);
        await sequelize.query(`ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash) WHERE token_hash IS NOT NULL;`);

        // ── 3. subscriptions ─────────────────────────────────────────────────────
        // Missing billing_model, per_order_charge_bdt, partner_orders_this_week,
        // partner_pending_invoice_amount, extra_conversations, extra_charge.
        // Also entity status is ENUM('active','inactive','cancelled','suspended')
        // but squash has VARCHAR(50). We add the missing columns; the ENUM type
        // mismatch is a product-level review item (listed in report, not altered).
        await sequelize.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_model VARCHAR(20) NOT NULL DEFAULT 'flat_monthly';`);
        await sequelize.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS per_order_charge_bdt DECIMAL(6,2);`);
        await sequelize.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS partner_orders_this_week INTEGER NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS partner_pending_invoice_amount DECIMAL(10,2) NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS extra_conversations INTEGER NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS extra_charge DECIMAL(10,2) NOT NULL DEFAULT 0;`);
        // Squash also lacks usage_reset_at — add it
        await sequelize.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS usage_reset_at TIMESTAMPTZ;`);

        // ── 4. payment_configs ───────────────────────────────────────────────────
        // Squash column: 'provider' VARCHAR(50), 'is_active' BOOLEAN
        // Entity column: 'gateway' ENUM('cod','self-mfs'), 'is_enabled' BOOLEAN
        // Add 'gateway' and 'is_enabled'; keep old columns.
        await sequelize.query(`ALTER TABLE payment_configs ADD COLUMN IF NOT EXISTS gateway VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE payment_configs ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
        // Backfill gateway from provider for existing rows
        await sequelize.query(`UPDATE payment_configs SET gateway = provider WHERE gateway IS NULL AND provider IS NOT NULL;`);
        // Backfill is_enabled from is_active for existing rows
        await sequelize.query(`UPDATE payment_configs SET is_enabled = is_active WHERE is_enabled = FALSE AND is_active = TRUE;`);
        // Unique index on (shop_id, gateway) — entity declares this
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_configs_shop_gateway ON payment_configs(shop_id, gateway) WHERE gateway IS NOT NULL;`);

        // ── 5. trx_id_logs ───────────────────────────────────────────────────────
        // Squash: gateway VARCHAR(50), screenshot_url TEXT, status VARCHAR(50), metadata JSONB
        // Entity: mfs_type VARCHAR(20), sender_phone, receiver_phone, ocr_raw TEXT, verified_at
        // Entity also lacks timestamps (no timestamps declared) — squash has created_at/updated_at.
        // Add entity columns; leave squash columns in place.
        await sequelize.query(`ALTER TABLE trx_id_logs ADD COLUMN IF NOT EXISTS mfs_type VARCHAR(20);`);
        await sequelize.query(`ALTER TABLE trx_id_logs ADD COLUMN IF NOT EXISTS sender_phone VARCHAR(20);`);
        await sequelize.query(`ALTER TABLE trx_id_logs ADD COLUMN IF NOT EXISTS receiver_phone VARCHAR(20);`);
        await sequelize.query(`ALTER TABLE trx_id_logs ADD COLUMN IF NOT EXISTS ocr_raw TEXT;`);
        await sequelize.query(`ALTER TABLE trx_id_logs ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;`);
        // Backfill mfs_type from gateway for existing rows
        await sequelize.query(`UPDATE trx_id_logs SET mfs_type = gateway WHERE mfs_type IS NULL AND gateway IS NOT NULL;`);
        // Entity unique index on (shop_id, trx_id)
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_trx_shop_trxid ON trx_id_logs(shop_id, trx_id);`);

        // ── 6. idempotency_keys ──────────────────────────────────────────────────
        // Squash: key VARCHAR(255), response JSONB, status_code INTEGER, expires_at TIMESTAMPTZ
        // Entity: idempotency_key STRING, user_id UUID NOT NULL, endpoint STRING,
        //         method ENUM, request_hash STRING, response_data JSON, status_code INTEGER, expires_at
        await sequelize.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS endpoint VARCHAR(500);`);
        await sequelize.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS method VARCHAR(10);`);
        await sequelize.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS request_hash VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response_data JSONB;`);
        // Backfill idempotency_key from key for existing rows
        await sequelize.query(`UPDATE idempotency_keys SET idempotency_key = key WHERE idempotency_key IS NULL AND key IS NOT NULL;`);
        // Backfill response_data from response for existing rows
        await sequelize.query(`UPDATE idempotency_keys SET response_data = response WHERE response_data IS NULL AND response IS NOT NULL;`);
        // Entity declares composite unique (idempotency_key, shop_id)
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_shop_key ON idempotency_keys(idempotency_key, shop_id) WHERE idempotency_key IS NOT NULL;`);

        console.log('[migration] 20260522_003_fix_schema_drift_auth_billing: UP complete');
    },

    down: async (sequelize) => {
        // idempotency_keys
        await sequelize.query(`DROP INDEX IF EXISTS idx_idempotency_shop_key;`);
        await sequelize.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS response_data;`);
        await sequelize.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS request_hash;`);
        await sequelize.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS method;`);
        await sequelize.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS endpoint;`);
        await sequelize.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS idempotency_key;`);

        // trx_id_logs
        await sequelize.query(`DROP INDEX IF EXISTS idx_trx_shop_trxid;`);
        await sequelize.query(`ALTER TABLE trx_id_logs DROP COLUMN IF EXISTS verified_at;`);
        await sequelize.query(`ALTER TABLE trx_id_logs DROP COLUMN IF EXISTS ocr_raw;`);
        await sequelize.query(`ALTER TABLE trx_id_logs DROP COLUMN IF EXISTS receiver_phone;`);
        await sequelize.query(`ALTER TABLE trx_id_logs DROP COLUMN IF EXISTS sender_phone;`);
        await sequelize.query(`ALTER TABLE trx_id_logs DROP COLUMN IF EXISTS mfs_type;`);

        // payment_configs
        await sequelize.query(`DROP INDEX IF EXISTS idx_payment_configs_shop_gateway;`);
        await sequelize.query(`ALTER TABLE payment_configs DROP COLUMN IF EXISTS is_enabled;`);
        await sequelize.query(`ALTER TABLE payment_configs DROP COLUMN IF EXISTS gateway;`);

        // subscriptions
        await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS usage_reset_at;`);
        await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS extra_charge;`);
        await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS extra_conversations;`);
        await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS partner_pending_invoice_amount;`);
        await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS partner_orders_this_week;`);
        await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS per_order_charge_bdt;`);
        await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS billing_model;`);

        // password_reset_tokens
        await sequelize.query(`DROP INDEX IF EXISTS idx_prt_token_hash;`);
        await sequelize.query(`ALTER TABLE password_reset_tokens DROP COLUMN IF EXISTS used_at;`);
        await sequelize.query(`ALTER TABLE password_reset_tokens DROP COLUMN IF EXISTS token_hash;`);

        // user_sessions
        await sequelize.query(`DROP INDEX IF EXISTS idx_user_sessions_active;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_user_sessions_expires;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_user_sessions_user;`);
        await sequelize.query(`DROP TABLE IF EXISTS user_sessions CASCADE;`);

        console.log('[migration] 20260522_003_fix_schema_drift_auth_billing: DOWN complete');
    }
};
