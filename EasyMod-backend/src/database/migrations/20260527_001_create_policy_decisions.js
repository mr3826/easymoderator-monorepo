/**
 * Migration: 20260527_001_create_policy_decisions
 *
 * Phase 3 — Policy Engine
 *
 * Creates the append-only audit log for every outbound send decision made by
 * `policy.engine.evaluateOutbound()`. Every send (allowed OR denied) writes
 * exactly one row; this is the source of truth for compliance review.
 *
 * Schema:
 *   id                 UUID PK
 *   shop_id            UUID  (indexed)
 *   channel_id         UUID  nullable — meta_channels(id), null when channel unknown
 *   conversation_id    UUID  nullable
 *   customer_id        UUID  nullable
 *   platform           VARCHAR(32)  ('facebook' | 'instagram')
 *   direction          VARCHAR(16)  default 'outbound'
 *   allow              BOOLEAN      — final engine verdict
 *   reason             VARCHAR(64)  — short code, e.g. 'OK' / 'OUTSIDE_24H' / 'OPTED_OUT'
 *   rule_results       JSONB        — per-rule [{ name, allow, reason }]
 *   transform_applied  BOOLEAN      — content sanitizer changed message body
 *   augment            JSONB        — { message_tag?, retry_after_ms? }
 *   policy_version     VARCHAR(32)
 *   message_hash       VARCHAR(64)  — sha256(message.text) for audit; raw text NOT stored
 *   created_at         TIMESTAMPTZ
 *
 * Indexes:
 *   INDEX(shop_id, created_at DESC) — dashboard timeline
 *   INDEX(reason)                   — analytics by deny reason
 */

'use strict';

module.exports = {
    name: '20260527_001_create_policy_decisions',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') {
            console.warn('[migration] 20260527_001 skipped — requires PostgreSQL');
            return;
        }

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS policy_decisions (
                id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id           UUID NOT NULL,
                channel_id        UUID NULL,
                conversation_id   UUID NULL,
                customer_id       UUID NULL,
                platform          VARCHAR(32) NOT NULL,
                direction         VARCHAR(16) NOT NULL DEFAULT 'outbound',
                allow             BOOLEAN NOT NULL,
                reason            VARCHAR(64) NOT NULL,
                rule_results      JSONB NOT NULL DEFAULT '[]'::jsonb,
                transform_applied BOOLEAN NOT NULL DEFAULT FALSE,
                augment           JSONB NOT NULL DEFAULT '{}'::jsonb,
                policy_version    VARCHAR(32) NOT NULL,
                message_hash      VARCHAR(64) NULL,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_policy_decisions_shop_created
                ON policy_decisions (shop_id, created_at DESC);
        `);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_policy_decisions_reason
                ON policy_decisions (reason);
        `);

        console.log('[migration] 20260527_001 policy_decisions table created');
    },

    down: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') return;
        await sequelize.query(`DROP TABLE IF EXISTS policy_decisions;`);
        console.log('[migration] 20260527_001 reverted — policy_decisions dropped');
    }
};
