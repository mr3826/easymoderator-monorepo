require('module-alias/register');
require('dotenv').config();

const { sequelize } = require('src/utils/database/database-setup');

/**
 * Migration System for Schema Changes
 * 
 * All migrations must:
 * - Be backward compatible
 * - Include rollback scripts
 * - Include indexes for performance
 * - Be idempotent (safe to run multiple times)
 */

const migrations = [
  require('./migrations/20260123_001_create_usage_events_table'),
  require('./migrations/20260123_002_create_subscription_tables'),
];

const createMigrationsTable = async () => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const isMigrationExecuted = async (name) => {
  const [results] = await sequelize.query(
    `SELECT name FROM migrations WHERE name = ?`,
    { replacements: [name] }
  );
  return results.length > 0;
};

const recordMigration = async (name) => {
  await sequelize.query(
    `INSERT INTO migrations (name, executed_at) VALUES (?, DATETIME('now'))`,
    { replacements: [name] }
  );
};

const removeMigrationRecord = async (name) => {
  await sequelize.query(
    `DELETE FROM migrations WHERE name = ?`,
    { replacements: [name] }
  );
};

const runMigrations = async () => {
  console.log('Starting migrations...');
  
  await createMigrationsTable();
  
  for (const migration of migrations) {
    const { name, up } = migration;
    
    if (await isMigrationExecuted(name)) {
      console.log(`⏭️  Migration ${name} already executed, skipping...`);
      continue;
    }
    
    console.log(`▶️  Running migration: ${name}`);
    
    try {
      await up(sequelize);
      await recordMigration(name);
      console.log(`✅ Migration ${name} completed successfully`);
    } catch (error) {
      console.error(`❌ Migration ${name} failed:`, error.message);
      throw error;
    }
  }
  
  console.log('✅ All migrations completed successfully!');
};

const rollbackLastMigration = async () => {
  console.log('Rolling back last migration...');
  
  await createMigrationsTable();
  
  const [results] = await sequelize.query(
    `SELECT name FROM migrations ORDER BY executed_at DESC LIMIT 1`
  );
  
  if (results.length === 0) {
    console.log('No migrations to rollback');
    return;
  }
  
  const lastMigrationName = results[0].name;
  const migration = migrations.find(m => m.name === lastMigrationName);
  
  if (!migration) {
    console.error(`Migration ${lastMigrationName} not found in migration files`);
    return;
  }
  
  console.log(`▶️  Rolling back: ${lastMigrationName}`);
  
  try {
    await migration.down(sequelize);
    await removeMigrationRecord(lastMigrationName);
    console.log(`✅ Rollback of ${lastMigrationName} completed successfully`);
  } catch (error) {
    console.error(`❌ Rollback of ${lastMigrationName} failed:`, error.message);
    throw error;
  }
};

const rollbackAllMigrations = async () => {
  console.log('Rolling back all migrations...');
  
  await createMigrationsTable();
  
  const [results] = await sequelize.query(
    `SELECT name FROM migrations ORDER BY executed_at DESC`
  );
  
  for (const row of results) {
    const migration = migrations.find(m => m.name === row.name);
    
    if (!migration) {
      console.warn(`⚠️  Migration ${row.name} not found in migration files, skipping...`);
      continue;
    }
    
    console.log(`▶️  Rolling back: ${row.name}`);
    
    try {
      await migration.down(sequelize);
      await removeMigrationRecord(row.name);
      console.log(`✅ Rollback of ${row.name} completed successfully`);
    } catch (error) {
      console.error(`❌ Rollback of ${row.name} failed:`, error.message);
      throw error;
    }
  }
  
  console.log('✅ All migrations rolled back successfully!');
};

// CLI interface
const command = process.argv[2];

(async () => {
  try {
    switch (command) {
      case 'up':
        await runMigrations();
        break;
      case 'down':
        await rollbackLastMigration();
        break;
      case 'down:all':
        await rollbackAllMigrations();
        break;
      case 'status':
        await createMigrationsTable();
        const [executed] = await sequelize.query(`SELECT * FROM migrations ORDER BY executed_at`);
        console.log('\n📋 Migration Status:');
        console.log('='.repeat(60));
        for (const migration of migrations) {
          const isExecuted = executed.some(e => e.name === migration.name);
          console.log(`${isExecuted ? '✅' : '⏸️ '} ${migration.name}${isExecuted ? ` (${executed.find(e => e.name === migration.name).executed_at})` : ''}`);
        }
        console.log('='.repeat(60));
        break;
      default:
        console.log(`
Migration System
================

Commands:
  node migrate.js up          - Run all pending migrations
  node migrate.js down        - Rollback last migration
  node migrate.js down:all    - Rollback all migrations
  node migrate.js status      - Show migration status

Rules:
  - All migrations must be backward compatible
  - All migrations must include rollback scripts
  - All migrations must include indexes for performance
  - All migrations must be idempotent
        `);
    }
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    await sequelize.close();
    process.exit(1);
  }
})();
