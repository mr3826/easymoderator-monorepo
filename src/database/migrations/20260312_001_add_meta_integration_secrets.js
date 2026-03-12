module.exports = {
  name: '20260312_001_add_meta_integration_secrets',

  up: async (sequelize) => {
    await sequelize.query('PRAGMA foreign_keys = OFF');
    try {
      await sequelize.query(`ALTER TABLE meta_integrations ADD COLUMN app_secret TEXT`);
      console.log('  ✓ Added app_secret column to meta_integrations');
    } catch (e) {
      if (!e.message.includes('duplicate column')) throw e;
    }
    try {
      await sequelize.query(`ALTER TABLE meta_integrations ADD COLUMN webhook_verify_token TEXT`);
      console.log('  ✓ Added webhook_verify_token column to meta_integrations');
    } catch (e) {
      if (!e.message.includes('duplicate column')) throw e;
    }
    try {
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_verify_token
         ON meta_integrations(webhook_verify_token)
         WHERE webhook_verify_token IS NOT NULL`
      );
      console.log('  ✓ Created unique index on webhook_verify_token');
    } catch (e) {
      // Partial indexes may not be supported in older SQLite — skip gracefully
      console.warn('  ⚠ Could not create partial index:', e.message);
    }
    await sequelize.query('PRAGMA foreign_keys = ON');
  },

  down: async (sequelize) => {
    console.log('  ⚠ SQLite does not support DROP COLUMN — manual rollback required.');
  }
};
