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
 * Strategy:
 *   1. Find and drop all existing single-column unique indexes on idempotency_key
 *   2. Create composite unique index (idempotency_key, shop_id)
 *
 * Backward Compatibility: YES
 *   - No data is modified or deleted
 *   - Existing idempotency keys remain valid within their tenant scope
 *   - Keys that were blocked cross-tenant are now independently valid
 *
 * Rollback: Drop composite index, restore single-column unique
 */

module.exports = {
  name: '20260218_002_fix_idempotency_composite',

  up: async (sequelize) => {
    // Check table exists before trying to alter it
    const [tables] = await sequelize.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_keys'`
    );
    if (tables.length === 0) {
      console.log('  ⏭  idempotency_keys table does not exist yet, skipping index fix');
      return;
    }

    // Discover all unique indexes that cover only idempotency_key (single-column)
    // and drop them so we can replace with the composite constraint.
    const [indexList] = await sequelize.query(`PRAGMA index_list('idempotency_keys')`);

    for (const idx of indexList) {
      if (!idx.unique) continue;
      if (idx.name === 'idx_idempotency_shop_key') continue; // our target index — keep it

      const [info] = await sequelize.query(`PRAGMA index_info('${idx.name}')`);
      const cols = info.map(i => i.name);

      // Drop only single-column unique indexes on idempotency_key
      if (cols.length === 1 && cols[0] === 'idempotency_key') {
        await sequelize.query(`DROP INDEX IF EXISTS "${idx.name}"`);
        console.log(`  ✓ Dropped global unique index: ${idx.name}`);
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
