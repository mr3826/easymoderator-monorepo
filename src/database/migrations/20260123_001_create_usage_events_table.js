/**
 * Migration: Create usage_events table
 * 
 * Purpose: Track all usage increment attempts for subscription billing
 * 
 * Backward Compatibility: YES
 * - Creates new table only
 * - No changes to existing tables
 * - Safe to run on existing databases
 * 
 * Indexes:
 * - UNIQUE(shop_id, resource_type, request_id) - Idempotency enforcement
 * - INDEX(shop_id, status) - Fast usage queries
 * - INDEX(created_at) - Audit log queries
 */

module.exports = {
  name: '20260123_001_create_usage_events_table',
  
  up: async (sequelize) => {
    // Create usage_events table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 1,
        request_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        metadata TEXT DEFAULT '{}',
        error_message TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    
    // Create UNIQUE index for idempotency
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_idempotency 
      ON usage_events(shop_id, resource_type, request_id)
    `);
    
    // Create index for usage queries (filter by shop and status)
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_events_shop_status 
      ON usage_events(shop_id, status)
    `);
    
    // Create index for audit queries (filter by date)
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_events_created_at 
      ON usage_events(created_at)
    `);
    
    // Create index for resource type queries
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_events_resource_type 
      ON usage_events(resource_type)
    `);
    
    console.log('  ✓ Created usage_events table');
    console.log('  ✓ Created idempotency index (shop_id, resource_type, request_id)');
    console.log('  ✓ Created usage query index (shop_id, status)');
    console.log('  ✓ Created audit query index (created_at)');
    console.log('  ✓ Created resource type index (resource_type)');
  },
  
  down: async (sequelize) => {
    // Drop indexes first
    await sequelize.query(`DROP INDEX IF EXISTS idx_usage_events_resource_type`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_usage_events_created_at`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_usage_events_shop_status`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_usage_events_idempotency`);
    
    // Drop table
    await sequelize.query(`DROP TABLE IF EXISTS usage_events`);
    
    console.log('  ✓ Dropped usage_events table and indexes');
  }
};
