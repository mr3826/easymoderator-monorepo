/**
 * Migration: order_sequences table for race-free order number generation (P2-4)
 * Replaces sequential ORDER BY created_at DESC lookup with atomic next_number.
 * PostgreSQL: use INSERT ... ON CONFLICT DO UPDATE RETURNING.
 * SQLite: use transaction + SELECT/UPDATE.
 */

module.exports = {
  name: '20260220_001_order_sequences_table',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();
    if (dialect === 'postgres') {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS order_sequences (
          shop_id UUID NOT NULL PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
          next_number INTEGER NOT NULL DEFAULT 1
        )
      `);
      await sequelize.query(`
        INSERT INTO order_sequences (shop_id, next_number)
        SELECT shop_id, COALESCE(MAX(CAST(SUBSTRING(order_number FROM 5) AS INTEGER)), 0) + 1
        FROM orders WHERE order_number IS NOT NULL AND order_number ~ '^ORD-[0-9]+$'
        GROUP BY shop_id
        ON CONFLICT (shop_id) DO NOTHING
      `);
    } else {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS order_sequences (
          shop_id TEXT NOT NULL PRIMARY KEY,
          next_number INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
        )
      `);
      const [rows] = await sequelize.query(`
        SELECT shop_id, order_number FROM orders WHERE order_number IS NOT NULL ORDER BY created_at DESC
      `);
      const maxByShop = {};
      for (const r of rows || []) {
        if (r.shop_id && r.order_number && /^ORD-\d+$/.test(r.order_number)) {
          const n = parseInt(r.order_number.replace('ORD-', ''), 10);
          if (!(r.shop_id in maxByShop) || maxByShop[r.shop_id] < n) maxByShop[r.shop_id] = n;
        }
      }
      for (const [sid, maxNum] of Object.entries(maxByShop)) {
        await sequelize.query(
          'INSERT OR REPLACE INTO order_sequences (shop_id, next_number) VALUES (?, ?)',
          { replacements: [sid, maxNum + 1] }
        );
      }
    }
  },

  down: async (sequelize) => {
    await sequelize.query(`DROP TABLE IF EXISTS order_sequences`);
  }
};
