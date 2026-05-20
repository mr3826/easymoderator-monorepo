/**
 * Migration: Create new tables for Features 2-5
 * - inventory_sync_configs: Store inventory sync provider configurations
 * - inventory_sync_logs: Track inventory sync history and changes
 * 
 * @file migrations/20260325_002_add_feature_tables.js
 */

module.exports = {
  name: '20260325_002_add_feature_tables',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();
    const boolType = dialect === 'sqlite' ? 'INTEGER' : 'BOOLEAN';
    const jsonType = dialect === 'sqlite' ? 'TEXT' : 'JSONB';

    // Create inventory_sync_configs table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_sync_configs (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL,
        provider VARCHAR(50) NOT NULL,
        credentials ${jsonType} NOT NULL,
        config ${jsonType} DEFAULT '{}',
        is_active ${boolType} NOT NULL DEFAULT ${dialect === 'sqlite' ? '1' : 'true'},
        last_sync TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shop_id, provider)
      )
    `);

    console.log('  ✓ Created inventory_sync_configs table');

    // Create inventory_sync_logs table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_sync_logs (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL,
        product_id UUID,
        sku VARCHAR(100),
        title VARCHAR(255),
        old_quantity INTEGER,
        new_quantity INTEGER,
        source VARCHAR(50),
        sync_type VARCHAR(50),
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('  ✓ Created inventory_sync_logs table');

    // Add indexes for performance
    if (dialect === 'postgres') {
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_inventory_sync_configs_shop 
        ON inventory_sync_configs(shop_id, is_active)
      `);

      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_inventory_sync_logs_shop 
        ON inventory_sync_logs(shop_id, created_at)
      `);

      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_inventory_sync_logs_sku 
        ON inventory_sync_logs(shop_id, sku)
      `);
    }

    console.log('  ✓ Created inventory sync indexes');
  },

  down: async (sequelize) => {
    await sequelize.query('DROP TABLE IF EXISTS inventory_sync_logs');
    await sequelize.query('DROP TABLE IF EXISTS inventory_sync_configs');
    console.log('  ✓ Dropped inventory sync tables');
  }
};
