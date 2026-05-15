/**
 * Migration: Add per-tenant workflow webhook URL to shops + dead-letter queue table
 *
 * Idempotent: ALTER TABLE statements are wrapped in try/catch so re-running the
 * migration on an already-migrated DB silently succeeds.
 */

module.exports = {
  name: '20260312_003_add_workflow_url_and_dlq',

  up: async (sequelize) => {
    const isDuplicateColumn = (e) =>
      /duplicate column/i.test(e.message) || /already exists/i.test(e.message);

    // ── A. shops table ──────────────────────────────────────────────────────

    try {
      await sequelize.query(`ALTER TABLE shops ADD COLUMN workflow_webhook_url TEXT`);
      console.log('  ✓ shops.workflow_webhook_url added');
    } catch (err) {
      if (isDuplicateColumn(err)) {
        console.log('  · shops.workflow_webhook_url already exists, skipping');
      } else {
        throw err;
      }
    }

    try {
      await sequelize.query(`ALTER TABLE shops ADD COLUMN workflow_webhook_secret TEXT`);
      console.log('  ✓ shops.workflow_webhook_secret added');
    } catch (err) {
      if (isDuplicateColumn(err)) {
        console.log('  · shops.workflow_webhook_secret already exists, skipping');
      } else {
        throw err;
      }
    }

    // ── B. failed_workflow_forwards (dead-letter queue) ────────────────────

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS failed_workflow_forwards (
        id          TEXT     PRIMARY KEY,
        shop_id     TEXT     NOT NULL,
        platform    TEXT     NOT NULL,
        event_data  TEXT     NOT NULL,
        error       TEXT     NOT NULL,
        attempt     INTEGER  NOT NULL DEFAULT 1,
        resolved    INTEGER  NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✓ failed_workflow_forwards table created (or already existed)');

    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_dlq_shop_resolved
       ON failed_workflow_forwards(shop_id, resolved)`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_dlq_created
       ON failed_workflow_forwards(created_at)`
    );
    console.log('  ✓ DLQ indexes created');
  },

  down: async (sequelize) => {
    await sequelize.query('DROP TABLE IF EXISTS failed_workflow_forwards');
    console.log('  ✓ failed_workflow_forwards dropped');
    console.log('  ⚠️  shops.workflow_webhook_url / workflow_webhook_secret cannot be dropped automatically — remove manually if needed.');
  }
};
