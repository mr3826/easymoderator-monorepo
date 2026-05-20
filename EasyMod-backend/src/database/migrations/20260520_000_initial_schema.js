'use strict';

/**
 * Migration: 20260520_000_initial_schema
 *
 * Squashed from 50 historical migrations (2026-05-20).
 * Creates the full EasyModerator schema from scratch on a fresh Postgres database.
 *
 * Intentionally EXCLUDED:
 *   - meta_integrations table (replaced by meta_channels)
 *   - channel_configs table (replaced by meta_channel_settings)
 *   - 'whatsapp' from customers.channel_type ENUM
 *   - marketing_opt_out column on customers (replaced by messaging_consent JSONB)
 *   - inventory_sync_logs table (inventory-sync subsystem deleted)
 *
 * Safe to run on a completely empty database.
 * All CREATE statements use IF NOT EXISTS / IF NOT EXISTS guards for idempotency.
 */

module.exports = {
    name: '20260520_000_initial_schema',

    up: async (sequelize) => {
        const { QueryTypes } = require('sequelize');

        // ── ENUM types ──────────────────────────────────────────────────────────

        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_customers_channel_type') THEN
                    CREATE TYPE enum_customers_channel_type AS ENUM (
                        'messenger', 'instagram', 'webchat', 'manual', 'facebook', 'telegram'
                    );
                END IF;
            END $$;
        `);

        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_customers_language_preference') THEN
                    CREATE TYPE enum_customers_language_preference AS ENUM ('bangla', 'english', 'banglish');
                END IF;
            END $$;
        `);

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

        // ── Core: tenants / users / shops ───────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS tenants (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name        VARCHAR(255) NOT NULL,
                is_active   BOOLEAN NOT NULL DEFAULT TRUE,
                settings    JSONB DEFAULT '{}',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS users (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email               VARCHAR(255) NOT NULL UNIQUE,
                password            TEXT NOT NULL,
                name                VARCHAR(255),
                role                VARCHAR(50) NOT NULL DEFAULT 'owner',
                is_active           BOOLEAN NOT NULL DEFAULT TRUE,
                is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
                token_version       INTEGER NOT NULL DEFAULT 0,
                two_fa_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
                two_fa_secret       TEXT,
                last_shop_id        UUID,
                settings            JSONB DEFAULT '{}',
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token       TEXT NOT NULL UNIQUE,
                expires_at  TIMESTAMPTZ NOT NULL,
                used        BOOLEAN NOT NULL DEFAULT FALSE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS shops (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                unique_code     VARCHAR(20) NOT NULL UNIQUE,
                tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                shop_name       VARCHAR(255) NOT NULL,
                name            VARCHAR(255) NOT NULL,
                is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                timezone        VARCHAR(50) NOT NULL DEFAULT 'Asia/Dhaka',
                business_hours  JSONB DEFAULT '{"start":"09:00","end":"22:00","days":[0,1,2,3,4,5,6]}',
                settings        JSONB DEFAULT '{}',
                config_version  INTEGER NOT NULL DEFAULT 1,
                platform_priority VARCHAR(50) DEFAULT 'facebook',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_shops_tenant ON shops(tenant_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_shops_unique_code ON shops(unique_code);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS user_shops (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                role        VARCHAR(50) NOT NULL DEFAULT 'owner',
                is_active   BOOLEAN NOT NULL DEFAULT TRUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(user_id, shop_id)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_user_shops_user ON user_shops(user_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_user_shops_shop ON user_shops(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id          TEXT PRIMARY KEY,
                user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                shop_id     UUID REFERENCES shops(id) ON DELETE CASCADE,
                token       TEXT NOT NULL UNIQUE,
                expires_at  TIMESTAMPTZ NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);`);

        // ── Catalog: categories / products ─────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                parent_category_id  UUID REFERENCES categories(id) ON DELETE CASCADE,
                name                VARCHAR(255) NOT NULL,
                description         TEXT,
                is_active           BOOLEAN NOT NULL DEFAULT TRUE,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_categories_shop ON categories(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS products (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
                name                VARCHAR(255) NOT NULL,
                description         TEXT,
                price               DECIMAL(10,2) NOT NULL DEFAULT 0,
                stock               INTEGER DEFAULT 0,
                track_quantity      BOOLEAN NOT NULL DEFAULT FALSE,
                sku                 VARCHAR(255),
                unit                VARCHAR(50),
                weight              DECIMAL(10,3),
                images              JSONB DEFAULT '[]',
                tags                JSONB DEFAULT '[]',
                ai_description      TEXT,
                ai_keywords         JSONB DEFAULT '[]',
                ai_embedding_id     VARCHAR(255),
                ai_synced_at        TIMESTAMPTZ,
                metadata            JSONB DEFAULT '{}',
                is_active           BOOLEAN NOT NULL DEFAULT TRUE,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(shop_id, sku);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_ai_synced ON products(ai_synced_at);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_active ON products(shop_id, is_active);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS product_variants (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                name        VARCHAR(255) NOT NULL,
                sku         VARCHAR(255),
                price       DECIMAL(10,2),
                stock       INTEGER DEFAULT 0,
                attributes  JSONB DEFAULT '{}',
                is_active   BOOLEAN NOT NULL DEFAULT TRUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_variants_shop ON product_variants(shop_id);`);

        // ── Customers ───────────────────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                name                VARCHAR(255),
                channel_type        enum_customers_channel_type NOT NULL,
                channel_user_id     VARCHAR(255) NOT NULL,
                language_preference enum_customers_language_preference,
                phone               VARCHAR(50),
                email               VARCHAR(255),
                last_active         TIMESTAMPTZ,
                metadata            JSONB DEFAULT '{}',
                messaging_consent   JSONB NOT NULL DEFAULT '{}',
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id);`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_shop_channel ON customers(shop_id, channel_type, channel_user_id);`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_shop_phone ON customers(shop_id, phone) WHERE phone IS NOT NULL;`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_shop_email ON customers(shop_id, email) WHERE email IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customers_channel_user_id ON customers(channel_user_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS customer_preferences (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                customer_id     UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                preferences     JSONB DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_custpref_shop ON customer_preferences(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS customer_delivery_stats (
                id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                customer_id                 UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
                shop_id                     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                total_orders                INTEGER NOT NULL DEFAULT 0,
                delivered_orders            INTEGER NOT NULL DEFAULT 0,
                refused_orders              INTEGER NOT NULL DEFAULT 0,
                rto_orders                  INTEGER NOT NULL DEFAULT 0,
                delivery_success_rate       DECIMAL(5,2) DEFAULT 0,
                last_updated                TIMESTAMPTZ,
                created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cds_shop ON customer_delivery_stats(shop_id);`);

        // ── Orders ──────────────────────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                order_number        VARCHAR(50),
                status              VARCHAR(50) NOT NULL DEFAULT 'pending',
                total_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
                cod_amount          DECIMAL(10,2) DEFAULT 0,
                delivery_charge     DECIMAL(10,2) DEFAULT 0,
                discount            DECIMAL(10,2) DEFAULT 0,
                customer_name       VARCHAR(255),
                customer_phone      VARCHAR(50),
                delivery_address    TEXT,
                delivery_area       VARCHAR(255),
                delivery_zone       VARCHAR(50),
                courier_provider    VARCHAR(50),
                tracking_id         VARCHAR(255),
                courier_status      VARCHAR(50),
                courier_data        JSONB,
                payment_method      VARCHAR(50),
                payment_status      VARCHAR(50) DEFAULT 'pending',
                notes               TEXT,
                metadata            JSONB DEFAULT '{}',
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(shop_id, status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier_provider, courier_status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_id) WHERE tracking_id IS NOT NULL;`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_sequences (
                shop_id     UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
                counter     INTEGER NOT NULL DEFAULT 0
            );
        `);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id  UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity    INTEGER NOT NULL DEFAULT 1,
                unit_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
                total_price DECIMAL(10,2) NOT NULL DEFAULT 0,
                product_name VARCHAR(255),
                metadata    JSONB DEFAULT '{}',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_returns (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                reason      VARCHAR(100),
                items       JSONB DEFAULT '[]',
                description TEXT,
                status      VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns(order_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_returns_customer ON order_returns(customer_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_sessions (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                conversation_id     UUID,
                session_data        JSONB NOT NULL DEFAULT '{}',
                step                VARCHAR(100),
                is_active           BOOLEAN NOT NULL DEFAULT TRUE,
                expires_at          TIMESTAMPTZ,
                completed_at        TIMESTAMPTZ,
                order_id            UUID REFERENCES orders(id) ON DELETE SET NULL,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_shop ON order_sessions(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_customer ON order_sessions(customer_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_active ON order_sessions(shop_id, is_active);`);

        // ── Conversations / Messages ─────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
                channel         VARCHAR(50),
                role            VARCHAR(50),
                message         TEXT,
                status          VARCHAR(50) NOT NULL DEFAULT 'open',
                hitl_active     BOOLEAN NOT NULL DEFAULT FALSE,
                hitl_reason     TEXT,
                hitl_started_at TIMESTAMPTZ,
                hitl_ended_at   TIMESTAMPTZ,
                resolved_at     TIMESTAMPTZ,
                resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
                resolution_note TEXT,
                metadata        JSONB DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_convs_shop ON conversations(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_convs_customer ON conversations(customer_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_convs_status ON conversations(shop_id, status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_convs_updated ON conversations(shop_id, updated_at DESC);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_convs_hitl ON conversations(shop_id, hitl_active) WHERE hitl_active = TRUE;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_convs_lookup ON conversations(shop_id, customer_id, channel, updated_at DESC);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
                content         TEXT NOT NULL DEFAULT '',
                sender          VARCHAR(50) NOT NULL DEFAULT 'customer',
                external_id     VARCHAR(255) UNIQUE,
                message_tag     VARCHAR(100),
                metadata        JSONB DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_msgs_conv ON messages(conversation_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_msgs_ext ON messages(external_id) WHERE external_id IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_msgs_created ON messages(conversation_id, created_at ASC);`);

        // ── Audit / Idempotency ─────────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID REFERENCES shops(id) ON DELETE CASCADE,
                user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
                action      VARCHAR(255) NOT NULL,
                resource    VARCHAR(100),
                resource_id VARCHAR(255),
                metadata    JSONB DEFAULT '{}',
                ip_address  VARCHAR(50),
                user_agent  TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_shop ON audit_logs(shop_id, created_at DESC);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS idempotency_keys (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
                key         VARCHAR(255) NOT NULL,
                response    JSONB,
                status_code INTEGER,
                expires_at  TIMESTAMPTZ NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(shop_id, key)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_idem_shop_key ON idempotency_keys(shop_id, key);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);`);

        // ── Delivery ────────────────────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS delivery_integrations (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                provider        VARCHAR(50) NOT NULL,
                is_active       BOOLEAN NOT NULL DEFAULT FALSE,
                credentials     JSONB DEFAULT '{}',
                config          JSONB DEFAULT '{}',
                last_tested_at  TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(shop_id, provider)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_delivery_int_shop ON delivery_integrations(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS delivery_costs (
                id              SERIAL PRIMARY KEY,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                zone_type       VARCHAR(20) NOT NULL,
                cost            DECIMAL(10,2) NOT NULL,
                estimated_days  INTEGER DEFAULT 1
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_delivery_costs_shop ON delivery_costs(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS known_areas (
                id              SERIAL PRIMARY KEY,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                area_name       VARCHAR(255) NOT NULL,
                area_name_bn    VARCHAR(255),
                zone_type       VARCHAR(50) NOT NULL,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_known_areas_shop ON known_areas(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS delivery_tracking (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                provider            VARCHAR(50) NOT NULL,
                tracking_number     VARCHAR(100) NOT NULL,
                current_status      VARCHAR(50),
                previous_status     VARCHAR(50),
                status_history      JSONB,
                location_info       JSONB,
                estimated_delivery  TIMESTAMPTZ,
                actual_delivery     TIMESTAMPTZ,
                delivery_agent_info JSONB,
                webhook_received_at TIMESTAMPTZ,
                last_api_check      TIMESTAMPTZ,
                customer_notified   BOOLEAN NOT NULL DEFAULT FALSE,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dt_order ON delivery_tracking(order_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dt_provider ON delivery_tracking(provider);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dt_status ON delivery_tracking(current_status);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS rto_blacklist (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                phone       VARCHAR(50) NOT NULL,
                reason      TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(shop_id, phone)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_rto_shop ON rto_blacklist(shop_id);`);

        // ── Payment ─────────────────────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS payment_configs (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                provider        VARCHAR(50) NOT NULL,
                is_active       BOOLEAN NOT NULL DEFAULT FALSE,
                credentials     JSONB DEFAULT '{}',
                config          JSONB DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(shop_id, provider)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_payment_config_shop ON payment_configs(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS trx_id_logs (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                order_id        UUID REFERENCES orders(id) ON DELETE CASCADE,
                trx_id          VARCHAR(255) NOT NULL,
                gateway         VARCHAR(50) NOT NULL,
                amount          DECIMAL(10,2) NOT NULL,
                screenshot_url  TEXT,
                status          VARCHAR(50) NOT NULL DEFAULT 'pending',
                metadata        JSONB DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_trx_shop ON trx_id_logs(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_trx_order ON trx_id_logs(order_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS payment_transactions (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                payment_method      VARCHAR(50) NOT NULL,
                payment_gateway     VARCHAR(50),
                transaction_id      VARCHAR(100) NOT NULL,
                amount              DECIMAL(10,2) NOT NULL,
                status              VARCHAR(20) NOT NULL DEFAULT 'pending',
                gateway_response    JSONB,
                verified_at         TIMESTAMPTZ,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ptxn_order ON payment_transactions(order_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ptxn_shop ON payment_transactions(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ptxn_status ON payment_transactions(shop_id, status);`);

        // ── Subscriptions / Billing ─────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id                 UUID NOT NULL UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
                plan_name               VARCHAR(100) NOT NULL DEFAULT 'Package 1',
                plan_code               VARCHAR(50) NOT NULL DEFAULT 'PACKAGE_1',
                plan_price              DECIMAL(10,2) NOT NULL DEFAULT 750,
                billing_cycle           VARCHAR(50) NOT NULL DEFAULT 'monthly',
                status                  VARCHAR(50) NOT NULL DEFAULT 'active',
                conversations_limit     INTEGER NOT NULL DEFAULT 500,
                conversations_used      INTEGER NOT NULL DEFAULT 0,
                topup_balance           INTEGER NOT NULL DEFAULT 0,
                threshold_conversations INTEGER NOT NULL DEFAULT 0,
                threshold_debt          INTEGER NOT NULL DEFAULT 0,
                orders_limit            INTEGER NOT NULL DEFAULT 50,
                orders_used             INTEGER NOT NULL DEFAULT 0,
                products_limit          INTEGER NOT NULL DEFAULT 100,
                products_used           INTEGER NOT NULL DEFAULT 0,
                features                JSONB DEFAULT '{}',
                current_period_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                current_period_end      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
                next_billing_date       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
                trial_ends_at           TIMESTAMPTZ,
                usage_reset_at          TIMESTAMPTZ,
                cancelled_at            TIMESTAMPTZ,
                created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sub_status ON subscriptions(status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sub_next_billing ON subscriptions(next_billing_date);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id                  TEXT PRIMARY KEY,
                subscription_id     UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                invoice_number      TEXT NOT NULL UNIQUE,
                billing_period      TEXT NOT NULL,
                billing_period_start TIMESTAMPTZ,
                billing_period_end  TIMESTAMPTZ,
                invoice_type        VARCHAR(50) NOT NULL DEFAULT 'monthly_subscription',
                amount              DECIMAL(10,2) NOT NULL DEFAULT 0,
                base_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
                extra_usage_amount  DECIMAL(10,2) DEFAULT 0,
                addon_amount        DECIMAL(10,2) DEFAULT 0,
                status              VARCHAR(50) NOT NULL DEFAULT 'pending',
                due_date            TIMESTAMPTZ NOT NULL,
                paid_at             TIMESTAMPTZ,
                payment_method      VARCHAR(50),
                transaction_id      VARCHAR(100),
                notes               TEXT,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_inv_sub ON invoices(subscription_id, status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_inv_shop ON invoices(shop_id, status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_inv_due ON invoices(status, due_date);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_invoices (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                invoice_number  VARCHAR(100) NOT NULL UNIQUE,
                pdf_url         VARCHAR(500),
                status          VARCHAR(20) NOT NULL DEFAULT 'generated',
                sent_via        JSONB,
                customer_info   JSONB,
                order_data      JSONB,
                payment_info    JSONB,
                tax_info        JSONB,
                delivery_info   JSONB,
                qr_code_url     VARCHAR(500),
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_oinv_order ON order_invoices(order_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_oinv_shop ON order_invoices(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS usage_events (
                id                  TEXT PRIMARY KEY,
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                resource_type       TEXT NOT NULL,
                request_id          TEXT NOT NULL,
                delta               INTEGER NOT NULL DEFAULT 1,
                transaction_id      TEXT,
                status              TEXT NOT NULL DEFAULT 'pending',
                resource_id         TEXT,
                resource_metadata   TEXT,
                error_message       TEXT,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                committed_at        TIMESTAMPTZ,
                UNIQUE(shop_id, resource_type, request_id)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ue_shop_status ON usage_events(shop_id, status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ue_created ON usage_events(created_at);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS conversation_topup_logs (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                topup_amount    INTEGER NOT NULL,
                price_bdt       DECIMAL(10,2) NOT NULL,
                payment_method  VARCHAR(50),
                transaction_id  VARCHAR(100),
                notes           TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_topup_shop ON conversation_topup_logs(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS reconciliation_runs (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID REFERENCES shops(id) ON DELETE CASCADE,
                provider        VARCHAR(50) NOT NULL,
                run_date        TIMESTAMPTZ NOT NULL,
                status          VARCHAR(50) NOT NULL DEFAULT 'pending',
                total_matched   INTEGER DEFAULT 0,
                total_unmatched INTEGER DEFAULT 0,
                total_disputed  INTEGER DEFAULT 0,
                report_url      TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS courier_cod_collections (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                provider        VARCHAR(50) NOT NULL,
                tracking_id     VARCHAR(255) NOT NULL,
                order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
                expected_amount DECIMAL(10,2) NOT NULL,
                received_amount DECIMAL(10,2),
                status          VARCHAR(50) NOT NULL DEFAULT 'pending',
                remittance_date TIMESTAMPTZ,
                notes           TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cod_shop ON courier_cod_collections(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS reconciliation_disputes (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                cod_id          UUID REFERENCES courier_cod_collections(id) ON DELETE CASCADE,
                dispute_type    VARCHAR(50) NOT NULL,
                amount_diff     DECIMAL(10,2),
                description     TEXT,
                status          VARCHAR(50) NOT NULL DEFAULT 'open',
                resolved_at     TIMESTAMPTZ,
                resolution_note TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_rd_shop ON reconciliation_disputes(shop_id);`);

        // ── Knowledge / Content ─────────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS faq_responses (
                id              SERIAL PRIMARY KEY,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                category        VARCHAR(100) NOT NULL,
                template_bn     TEXT,
                template_en     TEXT,
                variables       JSONB DEFAULT '[]',
                priority        INTEGER DEFAULT 0,
                use_count       INTEGER NOT NULL DEFAULT 0,
                is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_faq_shop ON faq_responses(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS knowledge_documents (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                content     TEXT NOT NULL,
                doc_type    VARCHAR(50) DEFAULT 'general',
                embedding_id VARCHAR(255),
                synced_at   TIMESTAMPTZ,
                is_active   BOOLEAN NOT NULL DEFAULT TRUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_kdoc_shop ON knowledge_documents(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS knowledge_gaps (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                question    TEXT NOT NULL,
                frequency   INTEGER NOT NULL DEFAULT 1,
                last_seen   TIMESTAMPTZ,
                status      VARCHAR(50) DEFAULT 'unresolved',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_kgap_shop ON knowledge_gaps(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS keywords (
                id              SERIAL PRIMARY KEY,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                pattern         VARCHAR(500) NOT NULL,
                pattern_type    VARCHAR(50) DEFAULT 'contains',
                response_type   VARCHAR(50) NOT NULL,
                response_data   JSONB NOT NULL,
                language        VARCHAR(50) DEFAULT 'any',
                priority        INTEGER DEFAULT 0,
                is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_keywords_shop ON keywords(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS response_templates (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                name        VARCHAR(255) NOT NULL,
                content     TEXT NOT NULL,
                language    VARCHAR(10) DEFAULT 'any',
                tags        JSONB DEFAULT '[]',
                is_active   BOOLEAN NOT NULL DEFAULT TRUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_rtmpl_shop ON response_templates(shop_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS banglish_dictionary (
                id          SERIAL PRIMARY KEY,
                banglish    VARCHAR(255) NOT NULL UNIQUE,
                bangla      VARCHAR(255) NOT NULL,
                confidence  INTEGER DEFAULT 100
            );
        `);

        // ── Analytics ───────────────────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS analytics (
                id              SERIAL PRIMARY KEY,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                date            DATE NOT NULL,
                total_messages  INTEGER DEFAULT 0,
                llm_calls       INTEGER DEFAULT 0,
                cache_hits      INTEGER DEFAULT 0,
                keyword_matches INTEGER DEFAULT 0,
                cost_estimate   DECIMAL(10,4) DEFAULT 0,
                metadata        JSONB DEFAULT '{}'
            );
        `);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_shop_date ON analytics(shop_id, date);`);

        // ── Support / Notifications ─────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS support_tickets (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                ticket_number   VARCHAR(50) NOT NULL,
                tenant_id       UUID NOT NULL,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
                priority        VARCHAR(20) DEFAULT 'low',
                category        VARCHAR(100),
                description     TEXT,
                status          VARCHAR(50) NOT NULL DEFAULT 'open',
                assigned_to     VARCHAR(100),
                metadata        JSONB DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_st_shop ON support_tickets(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_st_tenant ON support_tickets(tenant_id);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS owner_notifications (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                type            VARCHAR(50) NOT NULL,
                customer_message TEXT,
                customer_data   JSONB,
                status          VARCHAR(20) NOT NULL DEFAULT 'pending',
                owner_response  VARCHAR(20),
                owner_info      JSONB,
                responded_at    TIMESTAMPTZ,
                expires_at      TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_on_shop ON owner_notifications(shop_id, status);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                subscription    JSONB NOT NULL,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_push_shop ON push_subscriptions(shop_id);`);

        // ── Policy Engine ────────────────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS policy_decisions (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
                channel_id      UUID,
                platform        VARCHAR(50),
                action          VARCHAR(50) NOT NULL,
                decision        VARCHAR(20) NOT NULL,
                reason          VARCHAR(100),
                metadata        JSONB DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pd_shop ON policy_decisions(shop_id, created_at DESC);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pd_customer ON policy_decisions(customer_id);`);

        // ── Meta Channels (Phase 1-5 unified schema) ───────────────────────────

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
                updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(shop_id, platform),
                UNIQUE(meta_asset_id)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_mc_status ON meta_channels(status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_mc_token_exp ON meta_channels(token_expires_at);`);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS meta_channel_settings (
                channel_id                      UUID PRIMARY KEY REFERENCES meta_channels(id) ON DELETE CASCADE,
                ai_auto_reply                   BOOLEAN NOT NULL DEFAULT TRUE,
                automation_mode                 enum_meta_channel_settings_automation_mode NOT NULL DEFAULT 'AI_ACTIVE',
                confidence_threshold_send       DECIMAL(3,2) NOT NULL DEFAULT 0.75,
                confidence_threshold_suggest    DECIMAL(3,2) NOT NULL DEFAULT 0.50,
                business_hours                  JSONB,
                allow_order_creation            BOOLEAN NOT NULL DEFAULT TRUE,
                comment_to_dm_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
                comment_to_dm_post_filter       JSONB NOT NULL DEFAULT '[]',
                comment_to_dm_keywords          JSONB NOT NULL DEFAULT '[]',
                created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

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
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_consent_shop_cust ON meta_channel_consent_events(shop_id, customer_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_consent_channel ON meta_channel_consent_events(channel_id);`);

        // ── Comment-to-DM (Phase 4) ────────────────────────────────────────────

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS comment_to_dm_events (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                channel_id          UUID NOT NULL REFERENCES meta_channels(id) ON DELETE CASCADE,
                customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
                conversation_id     UUID REFERENCES conversations(id) ON DELETE SET NULL,
                comment_id          VARCHAR(255) NOT NULL,
                post_id             VARCHAR(255),
                platform            VARCHAR(50) NOT NULL,
                comment_text        TEXT,
                state               VARCHAR(50) NOT NULL DEFAULT 'COMMENT_SEEN',
                dm_invite_sent_at   TIMESTAMPTZ,
                dm_opened_at        TIMESTAMPTZ,
                dm_conversation_id  UUID,
                expires_at          TIMESTAMPTZ,
                metadata            JSONB DEFAULT '{}',
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(shop_id, comment_id)
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ctdm_shop ON comment_to_dm_events(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ctdm_channel ON comment_to_dm_events(channel_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ctdm_state ON comment_to_dm_events(state);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ctdm_expires ON comment_to_dm_events(expires_at);`);

        console.log('[migration] 20260520_000_initial_schema: UP complete — full schema created');
    },

    down: async (sequelize) => {
        // Drop in reverse FK dependency order
        const tables = [
            'comment_to_dm_events',
            'meta_channel_consent_events',
            'meta_channel_settings',
            'meta_channels',
            'policy_decisions',
            'push_subscriptions',
            'owner_notifications',
            'support_tickets',
            'analytics',
            'banglish_dictionary',
            'response_templates',
            'keywords',
            'knowledge_gaps',
            'knowledge_documents',
            'faq_responses',
            'reconciliation_disputes',
            'courier_cod_collections',
            'reconciliation_runs',
            'conversation_topup_logs',
            'usage_events',
            'order_invoices',
            'payment_transactions',
            'trx_id_logs',
            'payment_configs',
            'rto_blacklist',
            'delivery_tracking',
            'known_areas',
            'delivery_costs',
            'delivery_integrations',
            'customer_delivery_stats',
            'customer_preferences',
            'invoices',
            'subscriptions',
            'audit_logs',
            'idempotency_keys',
            'messages',
            'conversations',
            'order_sessions',
            'order_returns',
            'order_items',
            'order_sequences',
            'orders',
            'customers',
            'product_variants',
            'products',
            'categories',
            'user_shops',
            'sessions',
            'password_reset_tokens',
            'shops',
            'users',
            'tenants',
        ];

        for (const t of tables) {
            await sequelize.query(`DROP TABLE IF EXISTS ${t} CASCADE;`).catch(() => {});
        }

        // Drop ENUM types
        const types = [
            'enum_meta_channel_consent_events_source',
            'enum_meta_channel_consent_events_event',
            'enum_meta_channel_settings_automation_mode',
            'enum_meta_channels_status',
            'enum_meta_channels_platform',
            'enum_customers_language_preference',
            'enum_customers_channel_type',
        ];
        for (const t of types) {
            await sequelize.query(`DROP TYPE IF EXISTS ${t};`).catch(() => {});
        }

        console.log('[migration] 20260520_000_initial_schema: DOWN complete');
    }
};
