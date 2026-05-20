module.exports = {
  name: '20260419_001_create_customer_delivery_stats',

  up: async (sequelize) => {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS customer_delivery_stats (
        id                TEXT        PRIMARY KEY,
        phone             TEXT        NOT NULL,
        shop_id           TEXT        NOT NULL,
        delivery_attempts INTEGER     NOT NULL DEFAULT 0,
        rto_count         INTEGER     NOT NULL DEFAULT 0,
        last_rto_at       TIMESTAMPTZ,
        last_delivered_at TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✓ Created customer_delivery_stats table');

    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_cds_phone_shop ON customer_delivery_stats(phone, shop_id)`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_cds_phone ON customer_delivery_stats(phone)`
    );
    console.log('  ✓ Created customer_delivery_stats indexes');
  },

  down: async (sequelize) => {
    await sequelize.query('DROP TABLE IF EXISTS customer_delivery_stats');
    console.log('  ✓ Dropped customer_delivery_stats table');
  }
};
