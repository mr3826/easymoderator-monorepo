module.exports = {
  name: '20260312_002_create_rto_blacklist_table',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();
    const boolType = dialect === 'sqlite' ? 'INTEGER' : 'BOOLEAN';

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS rto_blacklist (
        id          TEXT      PRIMARY KEY,
        phone       TEXT      NOT NULL,
        reason      TEXT      NOT NULL,
        risk_score  INTEGER   NOT NULL DEFAULT 80,
        is_global   ${boolType} NOT NULL DEFAULT ${dialect === 'sqlite' ? '0' : 'false'},
        shop_id     TEXT,
        added_by    TEXT,
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✓ Created rto_blacklist table');

    // Expression-based unique index: treat NULL shop_id as empty string for uniqueness
    if (dialect === 'sqlite') {
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_rto_phone_shop
         ON rto_blacklist(phone, COALESCE(shop_id, ''))`
      );
    } else {
      // PostgreSQL: use COALESCE expression index
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_rto_phone_shop
         ON rto_blacklist(phone, COALESCE(shop_id, ''))`
      );
    }
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_rto_phone ON rto_blacklist(phone)`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_rto_shop ON rto_blacklist(shop_id)`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_rto_global ON rto_blacklist(is_global)`
    );
    console.log('  ✓ Created rto_blacklist indexes');
  },

  down: async (sequelize) => {
    await sequelize.query('DROP TABLE IF EXISTS rto_blacklist');
    console.log('  ✓ Dropped rto_blacklist table');
  }
};
