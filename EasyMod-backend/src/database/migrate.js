require('module-alias/register');
require('dotenv').config();

// sequelize is initialized after secrets are loaded (see async IIFE below)
let sequelize;

/**
 * Migration System for Schema Changes
 * 
 * All migrations must:
 * - Be backward compatible
 * - Include rollback scripts
 * - Include indexes for performance
 * - Be idempotent (safe to run multiple times)
 */

// Squashed migration (2026-05-20): 50 historical migrations replaced by a single initial schema.
// Historical migrations archived at src/database/migrations/archive/.
const migrations = [
  require('./migrations/20260520_000_initial_schema'),
  require('./migrations/20260522_001_fix_users_schema'),
  require('./migrations/20260522_002_fix_products_schema'),
  require('./migrations/20260522_003_fix_schema_drift_auth_billing'),
  require('./migrations/20260522_004_fix_schema_drift_orders_delivery'),
  require('./migrations/20260522_005_fix_schema_drift_customers_conversations'),
  require('./migrations/20260522_006_fix_schema_drift_catalog_content'),
  require('./migrations/20260522_007_fix_schema_drift_meta_recon'),
  require('./migrations/20260522_008_convert_enums'),
  require('./migrations/20260522_009_rto_blacklist_partial_unique'),
  require('./migrations/20260522_010_knowledge_gaps_pk'),
  require('./migrations/20260522_011_drop_legacy_columns'),
];

const createMigrationsTable = async () => {
  const dialect = sequelize.getDialect();
  if (dialect === 'postgres') {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } else {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
};

const isMigrationExecuted = async (name) => {
  const [results] = await sequelize.query(
    `SELECT name FROM migrations WHERE name = ?`,
    { replacements: [name] }
  );
  return results.length > 0;
};

const recordMigration = async (name) => {
  const dialect = sequelize.getDialect();
  if (dialect === 'postgres') {
    await sequelize.query(
      `INSERT INTO migrations (name, executed_at) VALUES (?, NOW())`,
      { replacements: [name] }
    );
  } else {
    await sequelize.query(
      `INSERT INTO migrations (name, executed_at) VALUES (?, DATETIME('now'))`,
      { replacements: [name] }
    );
  }
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

/**
 * Sync-bootstrap helper: marks every registered migration as already-executed
 * WITHOUT running its up() body. Used after `npm run db:sync` on a freshly-wiped
 * database, where Sequelize sync has created tables from the entity definitions
 * and the migration history must be primed so future deploys don't try to
 * re-apply the same DDL.
 */
const seedAllAsExecuted = async () => {
  console.log('Marking all known migrations as executed (sync-bootstrap mode)...');
  await createMigrationsTable();
  let added = 0;
  for (const migration of migrations) {
    if (!(await isMigrationExecuted(migration.name))) {
      await recordMigration(migration.name);
      console.log(`  marked: ${migration.name}`);
      added += 1;
    }
  }
  console.log(`✅ Done. ${added} new entries, ${migrations.length - added} already present.`);
};

/**
 * Exported for use by server.js startup — runs pending migrations using a
 * caller-supplied sequelize instance (avoids double secrets-load).
 */
const runMigrationsWithSequelize = async (seq) => {
  sequelize = seq;
  await runMigrations();
};

module.exports = { runMigrationsWithSequelize };

// CLI interface — only runs when invoked directly (node migrate.js), not when require()'d
if (require.main === module) {
const command = process.argv[2];

(async () => {
  // Load secrets from GCP Secret Manager before config.js is required
  await require('../config/secrets-loader')();
  // Initialize sequelize after secrets are loaded
  ({ sequelize } = require('../utils/database/database-setup'));

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
      case 'seed-as-executed':
        await seedAllAsExecuted();
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
  node migrate.js seed-as-executed - Mark all migrations as executed
                                    (after npm run db:sync on a fresh DB)

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
} // end require.main === module
