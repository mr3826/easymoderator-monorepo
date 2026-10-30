'use strict';

/**
 * Pilot+ P+02: structured customer choices + pilot flags.
 *
 * Additive only:
 *   - customer_interactions: server-side, channel-scoped interaction proposal
 *     records. The quick-reply payload is an OPAQUE REFERENCE to a row here —
 *     payloads carry no authority (docs/pilot-plus-v1/03 §4).
 *   - three new platform-controlled pilot flag columns (all default FALSE,
 *     SUPER_ADMIN-gated via the existing pilot-features API, ADR-0009).
 *
 * Reversal: drop the table, drop the columns. No existing data touched.
 */
module.exports = {
    name: '20261025_001_pilotplus_interactions_flags',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS customer_interactions (
                id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id              UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                customer_id          UUID REFERENCES customers(id) ON DELETE SET NULL,
                customer_channel_id  VARCHAR(255) NOT NULL,
                meta_channel_id      UUID,
                conversation_id      UUID REFERENCES conversations(id) ON DELETE SET NULL,
                kind                 VARCHAR(40) NOT NULL,
                bound_entity_type    VARCHAR(30),
                bound_entity_id      VARCHAR(64),
                bound_context_version VARCHAR(128),
                allowed_operation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                options              JSONB NOT NULL DEFAULT '[]'::jsonb,
                language             VARCHAR(10) NOT NULL DEFAULT 'bn',
                status               VARCHAR(20) NOT NULL DEFAULT 'GENERATED',
                expires_at           TIMESTAMPTZ NOT NULL,
                resolution           JSONB,
                created_by           VARCHAR(40) NOT NULL,
                created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT customer_interactions_kind_check
                    CHECK (kind IN ('CLARIFY_NEEDS', 'CHECKOUT_DECISION', 'HUMAN_SUPPORT', 'CHECKOUT_RESUME')),
                CONSTRAINT customer_interactions_status_check
                    CHECK (status IN ('GENERATED', 'SENT', 'EXECUTING', 'CONSUMED', 'SUPERSEDED', 'EXPIRED', 'VOID'))
            );
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_interactions_shop_status
                ON customer_interactions(shop_id, status, expires_at);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_interactions_conversation
                ON customer_interactions(conversation_id, status);
        `);
        // Supersession rule: one live proposal per conversation+kind.
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_interactions_live
                ON customer_interactions(conversation_id, kind)
                WHERE status IN ('GENERATED', 'SENT', 'EXECUTING');
        `);

        await sequelize.query(`
            ALTER TABLE shop_pilot_features
                ADD COLUMN IF NOT EXISTS interaction_choices BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS action_queue        BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS knowledge_suggestions BOOLEAN NOT NULL DEFAULT FALSE;
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE shop_pilot_features
                DROP COLUMN IF EXISTS interaction_choices,
                DROP COLUMN IF EXISTS action_queue,
                DROP COLUMN IF EXISTS knowledge_suggestions;
        `);
        await sequelize.query(`DROP TABLE IF EXISTS customer_interactions;`);
    },
};
