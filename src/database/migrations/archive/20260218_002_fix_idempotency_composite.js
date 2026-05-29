/**
 * Migration: Fix idempotency key uniqueness to be tenant-scoped
 *
 * Purpose: Fix P0 cross-tenant collision bug.
 *   Current: UNIQUE(idempotency_key) — global uniqueness across all shops.
 *   If Shop A uses key "order-123", Shop B cannot use key "order-123".
 *   This causes spurious 400 errors for innocent tenants sharing the same client.
 *
 *   Fixed: UNIQUE(idempotency_key, shop_id) — each tenant has its own key namespace.
 *
 * Backward Compatibility: YES
 * Rollback: Drop composite index, restore single-column unique
 */

module.exports = {
  name: '20260218_002_fix_idempotency_composite',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();

    // Check table exists
    let tableExists = false;
    if (dialect === 'sqlite') {
      const [tables] = await sequelize.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_keys'`
      );
      tableExists = tables.length > 0;
    } else {
      const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = 'idempotency_keys'`
      );
      tableExists = parseInt(rows[0].cnt, 10) > 0;
    }

    if (!tableExists) {
      console.log('  ⏭  idempotency_keys table does not exist yet, skipping index fix');
      return;
    }

    if (dialect === 'sqlite') {
      // Discover all unique indexes that cover only idempotency_key (single-column) and drop them
      const [indexList] = await sequelize.query(`PRAGMA index_list('idempotency_keys')`);

      for (const idx of indexList) {
        if (!idx.unique) continue;
        if (idx.name === 'idx_idempotency_shop_key') continue;

        const [info] = await sequelize.query(`PRAGMA index_info('${idx.name}')`);
        const cols = info.map(i => i.name);

        if (cols.length === 1 && cols[0] === 'idempotency_key') {
          await sequelize.query(`DROP INDEX IF EXISTS "${idx.name}"`);
          console.log(`  ✓ Dropped global unique index: ${idx.name}`);
        }
      }
    } else {
      // PostgreSQL: find and drop single-column unique indexes on idempotency_key
      const [indexes] = await sequelize.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'idempotency_keys'
          AND indexname != 'idx_idempotency_shop_key'
      `);

      for (const idx of indexes) {
        // Check if this index covers only the idempotency_key column
        const [cols] = await sequelize.query(`
          SELECT a.attname
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indrelid
          JOIN pg_class ci ON ci.oid = i.indexrelid
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
          WHERE ci.relname = '${idx.indexname}'
        `);
        if (cols.length === 1 && cols[0].attname === 'idempotency_key') {
          await sequelize.query(`DROP INDEX IF EXISTS "${idx.indexname}"`);
          console.log(`  ✓ Dropped global unique index: ${idx.indexname}`);
        }
      }
    }

    // Create tenant-scoped composite unique index
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_shop_key
      ON idempotency_keys(idempotency_key, shop_id)
    `);

    console.log('  ✓ Created composite unique index (idempotency_key, shop_id)');
    console.log('  ✓ Idempotency keys are now tenant-scoped — cross-tenant collisions eliminated');
  },

  down: async (sequelize) => {
    await sequelize.query('DROP INDEX IF EXISTS idx_idempotency_shop_key');
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_idempotency_key_unique
      ON idempotency_keys(idempotency_key)
    `);
    console.log('  ✓ Rolled back: idempotency key constraint reverted to global unique');
  }
};
