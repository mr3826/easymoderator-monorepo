/**
 * Migration: Harden audit_logs table constraints
 *
 * Purpose: Fix two P0 bugs that cause all background job audit writes to fail:
 *   1. user_id NOT NULL — system jobs write user_id: null → DB constraint violation
 *   2. action ENUM      — job action strings like "job:daily_overage_calculator" are
 *                         not in the ENUM → constraint violation on every job run
 *   3. resource_type ENUM — 'job' is not in the ENUM
 *   4. shop_id NOT NULL — system-wide jobs have no shop scope
 *
 * Strategy: SQLite does not support ALTER COLUMN, so we recreate the table with
 * relaxed constraints (nullable user_id/shop_id, free-form TEXT action/resource_type)
 * and copy existing data.
 *
 * Backward Compatibility: YES
 *   - Existing rows are preserved
 *   - Sequelize entity updated in parallel to match
 *   - Adds composite index (shop_id, resource_type, created_at) for query perf
 *
 * Rollback: Best-effort — cannot restore ENUM constraints without data loss risk
 */

module.exports = {
  name: '20260218_001_harden_audit_log',

  up: async (sequelize) => {
    // Disable FK constraints during table swap
    await sequelize.query('PRAGMA foreign_keys = OFF');

    try {
      // Remove any leftover from a previous failed run
      await sequelize.query('DROP TABLE IF EXISTS audit_logs_new');

      // Create replacement table: user_id/shop_id nullable, action/resource_type plain TEXT
      await sequelize.query(`
        CREATE TABLE audit_logs_new (
          id            TEXT     PRIMARY KEY,
          user_id       TEXT,
          shop_id       TEXT,
          action        TEXT     NOT NULL,
          resource_type TEXT     NOT NULL,
          resource_id   TEXT     NOT NULL,
          old_values    TEXT,
          new_values    TEXT,
          metadata      TEXT,
          ip_address    TEXT,
          user_agent    TEXT,
          idempotency_key TEXT,
          created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Check whether the old table exists (may not exist on fresh installs)
      const [tables] = await sequelize.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'`
      );

      if (tables.length > 0) {
        await sequelize.query(`
          INSERT INTO audit_logs_new
            (id, user_id, shop_id, action, resource_type, resource_id,
             old_values, new_values, metadata, ip_address, user_agent,
             idempotency_key, created_at)
          SELECT
            id, user_id, shop_id, action, resource_type, resource_id,
            old_values, new_values, metadata, ip_address, user_agent,
            idempotency_key, created_at
          FROM audit_logs
        `);
        await sequelize.query('DROP TABLE audit_logs');
        console.log('  ✓ Migrated existing audit_logs rows');
      }

      await sequelize.query('ALTER TABLE audit_logs_new RENAME TO audit_logs');

      // Recreate indexes
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS idx_audit_user_created
         ON audit_logs(user_id, created_at)`
      );
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS idx_audit_shop_created
         ON audit_logs(shop_id, created_at)`
      );
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS idx_audit_resource
         ON audit_logs(resource_type, resource_id)`
      );
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS idx_audit_shop_resource_created
         ON audit_logs(shop_id, resource_type, created_at)`
      );
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS idx_audit_idempotency
         ON audit_logs(idempotency_key)`
      );

      console.log('  ✓ audit_logs hardened: user_id/shop_id nullable, action/resource_type free-form TEXT');
      console.log('  ✓ Added composite index (shop_id, resource_type, created_at)');
    } finally {
      await sequelize.query('PRAGMA foreign_keys = ON');
    }
  },

  down: async (sequelize) => {
    // Cannot safely restore strict ENUM + NOT NULL constraints on live data
    // that may now contain job: prefixed actions or null user_ids.
    console.log('  ⚠️  Rollback skipped: restoring ENUM constraints would reject existing job audit rows.');
    console.log('      Manual intervention required if full rollback is needed.');
  }
};
