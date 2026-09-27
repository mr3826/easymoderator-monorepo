'use strict';

/**
 * Pilot intelligence: Customer 360 Lite, Sales Opportunities and RTO Shield v2
 * (Order Confidence). See docs/pilot-intelligence/05-data-model-and-migrations.md.
 *
 * Additive only: three new tables and one index on orders. No existing column
 * is altered and no backfill is required. The runner wraps this in a
 * transaction, so the orders index is a plain CREATE INDEX (brief write lock
 * on a pilot-sized table; documented in the migration notes).
 */
module.exports = {
    name: '20260927_001_pilot_customer_rto_intelligence',

    up: async (sequelize) => {
        // Platform-controlled pilot flags. Deliberately NOT under shops.settings,
        // which any shop member can patch (see ADR-0009).
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS shop_pilot_features (
                shop_id                 UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
                customer_intelligence   BOOLEAN NOT NULL DEFAULT FALSE,
                order_confidence_mode   VARCHAR(10) NOT NULL DEFAULT 'off',
                order_confidence_config JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_by              UUID,
                created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT shop_pilot_features_mode_check
                    CHECK (order_confidence_mode IN ('off', 'shadow', 'enforce'))
            );
        `);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS customer_opportunities (
                id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id            UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id        UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                conversation_id    UUID REFERENCES conversations(id) ON DELETE SET NULL,
                order_session_id   UUID,
                status             VARCHAR(20) NOT NULL DEFAULT 'OPEN',
                strength           VARCHAR(10) NOT NULL,
                reasons            JSONB NOT NULL DEFAULT '[]'::jsonb,
                signals            JSONB NOT NULL DEFAULT '[]'::jsonb,
                product_refs       JSONB NOT NULL DEFAULT '[]'::jsonb,
                first_signal_at    TIMESTAMPTZ NOT NULL,
                last_signal_at     TIMESTAMPTZ NOT NULL,
                detected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                detector_version   VARCHAR(40) NOT NULL,
                actioned_at        TIMESTAMPTZ,
                actioned_by        UUID,
                converted_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
                resolved_at        TIMESTAMPTZ,
                resolved_by        UUID,
                resolution_reason  VARCHAR(40),
                created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT customer_opportunities_status_check
                    CHECK (status IN ('OPEN', 'ACTIONED', 'CONVERTED', 'DISMISSED', 'EXPIRED')),
                CONSTRAINT customer_opportunities_strength_check
                    CHECK (strength IN ('HIGH', 'MEDIUM'))
            );
        `);
        // At most one live opportunity per customer — the dedupe invariant.
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_opportunities_live
                ON customer_opportunities(shop_id, customer_id)
                WHERE status IN ('OPEN', 'ACTIONED');
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_opportunities_shop_status
                ON customer_opportunities(shop_id, status, last_signal_at DESC);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_opportunities_customer
                ON customer_opportunities(shop_id, customer_id, last_signal_at DESC);
        `);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_confidence (
                id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id                UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                order_id               UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                customer_id            UUID REFERENCES customers(id) ON DELETE SET NULL,
                decision               VARCHAR(20) NOT NULL,
                reasons                JSONB NOT NULL DEFAULT '[]'::jsonb,
                rules_version          VARCHAR(40) NOT NULL,
                input_fingerprint      VARCHAR(64) NOT NULL,
                evaluated_at           TIMESTAMPTZ NOT NULL,
                mode                   VARCHAR(10) NOT NULL,
                resolution             VARCHAR(20),
                resolution_level       VARCHAR(20),
                resolution_fingerprint VARCHAR(64),
                resolution_method      VARCHAR(30),
                resolution_note        VARCHAR(500),
                resolved_by            UUID,
                resolved_at            TIMESTAMPTZ,
                last_gate_result       VARCHAR(30),
                last_gate_at           TIMESTAMPTZ,
                held_count             INTEGER NOT NULL DEFAULT 0,
                released_decision      JSONB,
                released_at            TIMESTAMPTZ,
                outcome                VARCHAR(30),
                outcome_at             TIMESTAMPTZ,
                history                JSONB NOT NULL DEFAULT '[]'::jsonb,
                version                INTEGER NOT NULL DEFAULT 1,
                created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT order_confidence_decision_check
                    CHECK (decision IN ('READY', 'VERIFY', 'MANUAL_REVIEW')),
                CONSTRAINT order_confidence_resolution_check
                    CHECK (resolution IS NULL OR resolution IN ('VERIFIED', 'APPROVED'))
            );
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_order_confidence_order
                ON order_confidence(order_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_order_confidence_shop_decision
                ON order_confidence(shop_id, decision);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_order_confidence_shop_gate
                ON order_confidence(shop_id, last_gate_result);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_order_confidence_shop_released
                ON order_confidence(shop_id, released_at);
        `);

        // Phone-history reads (Customer 360 phone association, order-confidence
        // history, duplicate-order detection) filter orders by shop + phone.
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_orders_shop_customer_phone
                ON orders(shop_id, customer_phone);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP INDEX IF EXISTS idx_orders_shop_customer_phone;');
        await sequelize.query('DROP TABLE IF EXISTS order_confidence CASCADE;');
        await sequelize.query('DROP TABLE IF EXISTS customer_opportunities CASCADE;');
        await sequelize.query('DROP TABLE IF EXISTS shop_pilot_features CASCADE;');
    },
};
