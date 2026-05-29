'use strict';

/**
 * Migration: create comment_to_dm_events
 *
 * Phase 4 — Comment-to-DM state machine.
 *
 * Each row tracks one comment from first receipt through optional automation
 * unlock. States advance via the CommentToDm state machine; every transition
 * writes last_transition_at and an SSE event.
 *
 * Idempotency: comment_id is UNIQUE — duplicate webhooks are silently ignored
 * via ON CONFLICT DO NOTHING in the service layer.
 */

module.exports = {
    name: '20260603_001_create_comment_to_dm_events',

    up: async (sequelize) => {
        // Create enums first (PostgreSQL requires them before use)
        await sequelize.query(`
            DO $$ BEGIN
                CREATE TYPE comment_to_dm_platform AS ENUM ('facebook', 'instagram');
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        `);

        await sequelize.query(`
            DO $$ BEGIN
                CREATE TYPE comment_to_dm_state AS ENUM (
                    'COMMENT_RECEIVED',
                    'MATCHED',
                    'BLOCKED',
                    'PUBLIC_REPLY_QUEUED',
                    'PUBLIC_REPLIED',
                    'DM_INVITE_SENT',
                    'CUSTOMER_OPENED_DM',
                    'AUTOMATION_UNLOCKED',
                    'EXPIRED',
                    'FAILED'
                );
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        `);

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS comment_to_dm_events (
                id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id                 UUID            NOT NULL
                                                        REFERENCES shops(id) ON DELETE CASCADE,
                channel_id              UUID            NOT NULL
                                                        REFERENCES meta_channels(id) ON DELETE CASCADE,
                platform                comment_to_dm_platform  NOT NULL,

                -- Comment identity
                post_id                 VARCHAR(64)     NOT NULL,
                comment_id              VARCHAR(64)     NOT NULL,
                parent_comment_id       VARCHAR(64)     NULL,

                -- Commenter identity
                commenter_external_id   VARCHAR(64)     NOT NULL,
                commenter_name          VARCHAR(255)    NULL,
                comment_text            TEXT            NULL,
                matched_keyword         VARCHAR(255)    NULL,

                -- State machine
                state                   comment_to_dm_state  NOT NULL DEFAULT 'COMMENT_RECEIVED',

                -- Linkage set after DM opens
                customer_id             UUID            NULL REFERENCES customers(id) ON DELETE SET NULL,
                conversation_id         UUID            NULL REFERENCES conversations(id) ON DELETE SET NULL,

                -- Audit
                last_transition_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
                last_error              TEXT            NULL,
                metadata                JSONB           NOT NULL DEFAULT '{}',

                created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
                updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
            )
        `);

        // UNIQUE on comment_id — one row per Facebook/IG comment
        await sequelize.query(`
            ALTER TABLE comment_to_dm_events
            ADD CONSTRAINT comment_to_dm_events_comment_id_unique UNIQUE (comment_id)
        `).catch(() => {}); // already exists on re-run

        // Index: list events by shop + state (dashboard query)
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_comment_to_dm_shop_state
            ON comment_to_dm_events (shop_id, state)
        `);

        // Index: expiry sweep — scan rows awaiting DM ordered by age
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_comment_to_dm_state_transition
            ON comment_to_dm_events (state, last_transition_at)
        `);

        // Index: webhook resolution — find event by channel + post
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_comment_to_dm_channel_post
            ON comment_to_dm_events (channel_id, post_id)
        `);
    },

    down: async (sequelize) => {
        await sequelize.query('DROP TABLE IF EXISTS comment_to_dm_events CASCADE');
        await sequelize.query('DROP TYPE IF EXISTS comment_to_dm_state CASCADE');
        await sequelize.query('DROP TYPE IF EXISTS comment_to_dm_platform CASCADE');
    },
};
