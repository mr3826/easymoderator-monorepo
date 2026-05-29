'use strict';

/**
 * Migration: 20260522_010_knowledge_gaps_pk
 *
 * Problem:
 *   The squash schema (20260520_000_initial_schema) created knowledge_gaps.id as UUID.
 *   The entity defines id as SERIAL INTEGER (autoIncrement: true).
 *   This mismatch causes Sequelize to fail on INSERT (it tries to insert an integer
 *   but the column is UUID type).
 *
 * Safety gate:
 *   This migration checks the row count FIRST.
 *   - If 0 rows: drop and recreate the table with the correct SERIAL INTEGER PK.
 *   - If > 0 rows: ABORT — do not destroy data. Log the count and throw.
 *
 * Table schema (from entity):
 *   id          SERIAL PRIMARY KEY
 *   shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE
 *   question    TEXT NOT NULL
 *   platform    VARCHAR(50) NOT NULL
 *   language    VARCHAR(20) DEFAULT 'mixed'
 *   source      VARCHAR(100) DEFAULT 'ai_handler'
 *   created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *
 * Note: updated_at is explicitly disabled in the entity (updatedAt: false).
 */

module.exports = {
    name: '20260522_010_knowledge_gaps_pk',

    up: async (sequelize) => {

        // ── Safety gate: check row count ──────────────────────────────────────────
        const [countResult] = await sequelize.query(`
            SELECT COUNT(*) AS cnt FROM knowledge_gaps;
        `);
        const rowCount = parseInt(countResult[0].cnt, 10);

        if (rowCount > 0) {
            const msg = `[migration 010] SAFETY GATE: knowledge_gaps has ${rowCount} row(s). ` +
                        `Cannot recreate table with non-empty data. ` +
                        `Manual intervention required: export data, truncate, then re-run migration.`;
            console.error(msg);
            throw new Error(msg);
        }

        console.log('[migration 010] knowledge_gaps is empty — safe to recreate with SERIAL INTEGER PK.');

        // ── Check current PK type ─────────────────────────────────────────────────
        const [pkCol] = await sequelize.query(`
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'knowledge_gaps' AND column_name = 'id';
        `);

        if (pkCol.length > 0 && pkCol[0].data_type === 'integer') {
            console.log('[migration 010] knowledge_gaps.id is already INTEGER, skip table recreation.');
            return;
        }

        // ── Drop and recreate with correct schema ─────────────────────────────────
        await sequelize.query(`DROP TABLE IF EXISTS knowledge_gaps;`);
        console.log('[migration 010] Dropped knowledge_gaps (was UUID PK, 0 rows).');

        await sequelize.query(`
            CREATE TABLE knowledge_gaps (
                id          SERIAL PRIMARY KEY,
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                question    TEXT NOT NULL,
                platform    VARCHAR(50) NOT NULL DEFAULT 'unknown',
                language    VARCHAR(20) NOT NULL DEFAULT 'mixed',
                source      VARCHAR(100) NOT NULL DEFAULT 'ai_handler',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        console.log('[migration 010] Recreated knowledge_gaps with SERIAL INTEGER PK.');

        // Entity-declared indexes (none explicit in entity, but add useful ones)
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_shop ON knowledge_gaps(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_created ON knowledge_gaps(shop_id, created_at DESC);`);

        console.log('[migration] 20260522_010_knowledge_gaps_pk: UP complete');
    },

    down: async (sequelize) => {
        // Recreate as UUID PK (squash original schema) — only safe if table is empty
        const [countResult] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM knowledge_gaps;`).catch(() => [[ { cnt: '0' } ]]);
        const rowCount = parseInt(countResult[0].cnt, 10);

        if (rowCount > 0) {
            console.warn('[migration 010 DOWN] knowledge_gaps has rows — cannot revert PK type. Leaving as-is.');
            return;
        }

        await sequelize.query(`DROP TABLE IF EXISTS knowledge_gaps;`);
        await sequelize.query(`
            CREATE TABLE knowledge_gaps (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                question    TEXT NOT NULL,
                platform    VARCHAR(50) NOT NULL DEFAULT 'unknown',
                language    VARCHAR(20) NOT NULL DEFAULT 'mixed',
                source      VARCHAR(100) NOT NULL DEFAULT 'ai_handler',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_shop ON knowledge_gaps(shop_id);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_created ON knowledge_gaps(shop_id, created_at DESC);`);

        console.log('[migration] 20260522_010_knowledge_gaps_pk: DOWN complete (reverted to UUID PK)');
    }
};
