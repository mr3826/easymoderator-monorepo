'use strict';

/** Durable per-turn recovery state and timeout telemetry. */
module.exports = {
    name: '20260823_001_conversation_turns',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS conversation_turns (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                turn_id             VARCHAR(255) NOT NULL,
                trace_id            VARCHAR(255) NOT NULL,
                shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                intent_id            VARCHAR(80),
                state               VARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
                retry_state         VARCHAR(50) NOT NULL DEFAULT 'NOT_STARTED',
                recovery_kind       VARCHAR(50),
                state_transitions   JSONB NOT NULL DEFAULT '[]'::jsonb,
                turn_started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                first_holding_at    TIMESTAMPTZ,
                hard_timeout_at     TIMESTAMPTZ,
                handoff_created_at  TIMESTAMPTZ,
                handoff_ack_at      TIMESTAMPTZ,
                retry_count         INTEGER NOT NULL DEFAULT 0,
                idempotency_key     VARCHAR(64),
                mutation_status     VARCHAR(50),
                outbound_status     VARCHAR(50),
                provider_reference  VARCHAR(255),
                recovery_reason     VARCHAR(255),
                final_state         VARCHAR(50),
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_turns_conversation_turn
                ON conversation_turns(conversation_id, turn_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_conversation_turns_shop_created
                ON conversation_turns(shop_id, created_at);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP TABLE IF EXISTS conversation_turns CASCADE;`);
    },
};
