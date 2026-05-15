'use strict';

module.exports = {
  name: '20260505_001_add_plan_code_to_subscriptions',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();
    const colType = dialect === 'postgres' ? 'VARCHAR(20)' : 'TEXT';

    await sequelize.query(
      `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_code ${colType} DEFAULT NULL`
    ).catch(() =>
      // SQLite doesn't support IF NOT EXISTS on ALTER TABLE
      sequelize.query(`ALTER TABLE subscriptions ADD COLUMN plan_code ${colType} DEFAULT NULL`)
        .catch(() => {})
    );

    // Backfill plan_code from plan_name for existing rows
    await sequelize.query(`
      UPDATE subscriptions
      SET plan_code = UPPER(plan_name)
      WHERE plan_code IS NULL AND plan_name IN ('Starter', 'Growth', 'Partner')
    `);
  },

  down: async (sequelize) => {
    const dialect = sequelize.getDialect();
    if (dialect === 'postgres') {
      await sequelize.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan_code`);
    }
    // SQLite does not support DROP COLUMN — no-op for rollback
  }
};
