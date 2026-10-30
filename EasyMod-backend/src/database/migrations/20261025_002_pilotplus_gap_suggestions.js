'use strict';

/**
 * Pilot+ P+05: knowledge gaps as merchant actions.
 *
 * knowledge_gap_suggestions — aggregated, merchant-reviewable improvement
 * items derived DETERMINISTICALLY from existing knowledge_gaps evidence.
 * Stores normalized question keys and evidence ids ONLY (never raw bursts,
 * never contact data). Dismissal records an evidence cursor so a suggestion
 * re-opens only when genuinely NEW unanswered questions arrive.
 *
 * Additive only; reversible by dropping the table.
 */
module.exports = {
    name: '20261025_002_pilotplus_gap_suggestions',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS knowledge_gap_suggestions (
                id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id            UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                norm_question      VARCHAR(200) NOT NULL,
                display_question   VARCHAR(300) NOT NULL,
                owner_domain       VARCHAR(20) NOT NULL DEFAULT 'POLICY',
                status             VARCHAR(20) NOT NULL DEFAULT 'OPEN',
                evidence_count     INTEGER NOT NULL DEFAULT 0,
                first_seen_at      TIMESTAMPTZ NOT NULL,
                last_seen_at       TIMESTAMPTZ NOT NULL,
                evidence_cursor    BIGINT NOT NULL DEFAULT 0,
                dismissed_reason   VARCHAR(40),
                dismissed_at       TIMESTAMPTZ,
                resolved_faq_id    INTEGER REFERENCES faq_responses(id) ON DELETE SET NULL,
                published_at       TIMESTAMPTZ,
                created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT gap_suggestions_domain_check
                    CHECK (owner_domain IN ('PAYMENT','DELIVERY','PRODUCT','POLICY','OTHER')),
                CONSTRAINT gap_suggestions_status_check
                    CHECK (status IN ('OPEN','IN_REVIEW','PUBLISHED','DISMISSED'))
            );
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_gap_suggestions_live
                ON knowledge_gap_suggestions(shop_id, norm_question)
                WHERE status IN ('OPEN','IN_REVIEW');
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_gap_suggestions_shop_status
                ON knowledge_gap_suggestions(shop_id, status, last_seen_at DESC);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP TABLE IF EXISTS knowledge_gap_suggestions;`);
    },
};
