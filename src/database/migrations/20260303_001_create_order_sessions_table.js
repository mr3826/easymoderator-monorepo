'use strict';

module.exports = {
  name: '20260303_001_create_order_sessions_table',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();

    // Check if table exists (sync() may have already created it)
    let tableExists = false;
    if (dialect === 'sqlite') {
      const [tables] = await sequelize.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='order_sessions'`
      );
      tableExists = tables.length > 0;
    } else {
      const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = 'order_sessions'`
      );
      tableExists = parseInt(rows[0].cnt, 10) > 0;
    }

    if (!tableExists) {
      // Create table if it doesn't exist (e.g., on existing SQLite DBs before sync)
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS order_sessions (
          id                   TEXT      PRIMARY KEY,
          shop_id              TEXT      NOT NULL,
          customer_id          TEXT,
          customer_channel_id  TEXT      NOT NULL,
          channel              TEXT      NOT NULL DEFAULT 'messenger',
          current_step         TEXT      NOT NULL DEFAULT 'INITIAL',
          step_data            TEXT,
          product_info         TEXT,
          status               TEXT      NOT NULL DEFAULT 'ACTIVE',
          automation_mode      TEXT      NOT NULL DEFAULT 'DRAFT',
          confidence_threshold INTEGER   NOT NULL DEFAULT 60,
          last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at           TIMESTAMPTZ,
          created_order_id     TEXT,
          final_summary        TEXT,
          metadata             TEXT,
          created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('  ✓ Created order_sessions table');
    } else {
      console.log('  ⏭  order_sessions table already exists, ensuring indexes...');
    }

    // Ensure indexes exist (idempotent)
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_shop_id ON order_sessions(shop_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_customer_id ON order_sessions(customer_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_channel_shop ON order_sessions(customer_channel_id, shop_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_status ON order_sessions(status)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_step ON order_sessions(current_step)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_activity ON order_sessions(last_activity_at)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_order_sessions_expires ON order_sessions(expires_at)`);

    console.log('  ✓ order_sessions indexes ensured');
  },

  down: async (sequelize) => {
    await sequelize.query('DROP TABLE IF EXISTS order_sessions');
    console.log('  ✓ Dropped order_sessions table');
  }
};
