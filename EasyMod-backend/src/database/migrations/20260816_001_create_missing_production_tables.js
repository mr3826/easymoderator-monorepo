'use strict';

/**
 * Migration: 20260816_001_create_missing_production_tables
 *
 * Problem:
 *   Production's `migrations` ledger records all 31 prior migrations as executed
 *   (all stamped 2026-07-26 13:28:56, with 20260520_000_initial_schema "completing"
 *   in ~4ms), but 8 tables that 20260520_000_initial_schema declares do not exist
 *   in the production database. Confirmed live failure:
 *
 *     [worker] handleOrderFlow failed for conv <id>:
 *              relation "order_sessions" does not exist
 *
 *   Because those migrations are marked executed, the runner skips them — re-running
 *   `npm run migrate` will NOT create the missing tables. Hence this forward-only
 *   migration, which does not rewrite the ledger.
 *
 * Scope — 4 of the 8 missing tables, the ones live code actually reads:
 *   - order_sessions       (order-session.entity.js, order-session-standalone.service.js)
 *   - order_sequences      (order.service.js — every order number INSERT)
 *   - knowledge_documents  (knowledge/auto-index.job.js)
 *   - rto_blacklist        (rto-blacklist.entity.js, public-stats.routes.js)
 *
 *   Deliberately NOT created — declared by the squash but referenced by zero
 *   non-test source files, so creating them would be speculative:
 *   comment_to_dm_events, conversation_topup_logs, reconciliation_runs, sessions.
 *   (Sessions are Redis-backed; the `sessions` table is unused.)
 *
 * Shape:
 *   Each table is created in its FINAL post-migration shape — the squash definition
 *   plus every later ALTER that also no-opped against the absent table. Creating the
 *   squash shape alone would leave them broken in a different way; e.g. the squash
 *   declares order_sequences.counter, but 20260611_003 renames it to next_number and
 *   order.service.js only ever writes next_number.
 *
 *   Applied on top of the squash definitions:
 *     order_sequences  counter -> next_number, DEFAULT 1        (20260611_003)
 *     order_sessions   +11 columns, 5 indexes                   (20260522_004)
 *     order_sessions   +metadata, customer_id DROP NOT NULL     (20260611_001)
 *     rto_blacklist    +5 columns                               (20260522_004)
 *     rto_blacklist    UNIQUE(shop_id,phone) -> partial uniques  (20260522_009)
 *     rto_blacklist    shop_id DROP NOT NULL                    (20260611_004)
 *
 * Idempotent: every statement is IF NOT EXISTS, so this is safe to run against an
 * environment where migrations were applied correctly and these tables already exist.
 */

module.exports = {
    name: '20260816_001_create_missing_production_tables',

    up: async (sequelize) => {
        // ── order_sequences ──────────────────────────────────────────────────────
        // Squash shape had `counter INTEGER NOT NULL DEFAULT 0`; 20260611_003 renamed
        // it to next_number and set DEFAULT 1. Created here already renamed.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_sequences (
                shop_id     UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
                next_number INTEGER NOT NULL DEFAULT 1
            );
        `);

        // ── order_sessions ───────────────────────────────────────────────────────
        // customer_id is nullable here: the squash created it NOT NULL, 20260611_001
        // dropped that because chatbot sessions start before a customer row exists.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS order_sessions (
                id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id                 UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id             UUID REFERENCES customers(id) ON DELETE CASCADE,
                conversation_id         UUID,
                session_data            JSONB NOT NULL DEFAULT '{}',
                step                    VARCHAR(100),
                is_active               BOOLEAN NOT NULL DEFAULT TRUE,
                expires_at              TIMESTAMPTZ,
                completed_at            TIMESTAMPTZ,
                order_id                UUID REFERENCES orders(id) ON DELETE SET NULL,
                created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                customer_channel_id     VARCHAR(255),
                channel                 VARCHAR(20) DEFAULT 'messenger',
                current_step            VARCHAR(50) DEFAULT 'INITIAL',
                step_data               JSONB DEFAULT '{}',
                product_info            JSONB,
                status                  VARCHAR(20) DEFAULT 'ACTIVE',
                automation_mode         VARCHAR(20) DEFAULT 'DRAFT',
                confidence_threshold    INTEGER DEFAULT 60,
                last_activity_at        TIMESTAMPTZ DEFAULT NOW(),
                created_order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
                final_summary           TEXT,
                metadata                JSONB DEFAULT '{}'
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_shop ON order_sessions(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_customer ON order_sessions(customer_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_active ON order_sessions(shop_id, is_active);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_customer_channel ON order_sessions(customer_channel_id, shop_id) WHERE customer_channel_id IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_status ON order_sessions(status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_current_step ON order_sessions(current_step);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_last_activity ON order_sessions(last_activity_at);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_expires ON order_sessions(expires_at);`);

        // ── knowledge_documents ──────────────────────────────────────────────────
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS knowledge_documents (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                title        TEXT NOT NULL,
                content      TEXT NOT NULL,
                doc_type     VARCHAR(50) DEFAULT 'general',
                embedding_id VARCHAR(255),
                synced_at    TIMESTAMPTZ,
                is_active    BOOLEAN NOT NULL DEFAULT TRUE,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_kdoc_shop ON knowledge_documents(shop_id);`);

        // ── rto_blacklist ────────────────────────────────────────────────────────
        // shop_id nullable (20260611_004) so global entries can omit it. No table-level
        // UNIQUE(shop_id, phone) — 20260522_009 replaced it with two partial uniques,
        // because NULL != NULL let duplicate global rows through.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS rto_blacklist (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID REFERENCES shops(id) ON DELETE CASCADE,
                phone       VARCHAR(50) NOT NULL,
                reason      TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                risk_score  INTEGER NOT NULL DEFAULT 80,
                is_global   BOOLEAN NOT NULL DEFAULT FALSE,
                added_by    UUID,
                notes       TEXT,
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_rto_shop ON rto_blacklist(shop_id);`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rto_shop_phone ON rto_blacklist(shop_id, phone) WHERE shop_id IS NOT NULL;`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rto_global_phone ON rto_blacklist(phone) WHERE is_global = true;`);
    },

    down: async (sequelize) => {
        // Only drops what this migration creates. CASCADE clears the dependent
        // indexes and the orders(id) FKs pointing out of order_sessions.
        await sequelize.query(`DROP TABLE IF EXISTS order_sessions CASCADE;`);
        await sequelize.query(`DROP TABLE IF EXISTS order_sequences CASCADE;`);
        await sequelize.query(`DROP TABLE IF EXISTS knowledge_documents CASCADE;`);
        await sequelize.query(`DROP TABLE IF EXISTS rto_blacklist CASCADE;`);
    },
};
