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

const migrations = [
  require('./migrations/20260123_001_create_usage_events_table'),
  require('./migrations/20260123_002_create_subscription_tables'),
  require('./migrations/20260202_001_add_product_fields'),
  require('./migrations/20260206_001_add_shop_knowledge_fields'),
  require('./migrations/20260206_002_add_shop_knowledge_documents'),
  require('./migrations/20260208_001_create_v2_tables'),
  require('./migrations/20260209_001_add_customer_email'),
  require('./migrations/20260209_002_add_conversation_fields'),
  require('./migrations/20260209_003_extend_channel_types'),
  // Infrastructure hardening — 2026-02-18
  require('./migrations/20260218_001_harden_audit_log'),
  require('./migrations/20260218_002_fix_idempotency_composite'),
  require('./migrations/20260218_003_add_invoice_period_dates'),
  require('./migrations/20260220_001_order_sequences_table'),
  require('./migrations/20260303_001_create_order_sessions_table'),
  require('./migrations/20260312_001_add_meta_integration_secrets'),
  require('./migrations/20260312_002_create_rto_blacklist_table'),
  require('./migrations/20260312_003_add_workflow_url_and_dlq'),
  require('./migrations/20260320_001_add_conversation_chatbot_columns'),
  require('./migrations/20260320_002_fix_order_sessions_json_columns'),
  require('./migrations/20260320_003_add_product_ai_columns'),
  require('./migrations/20260320_004_add_hitl_and_message_tag'),
  require('./migrations/20260320_005_add_faq_use_count'),
  require('./migrations/20260321_001_channel_configs_hardening'),
  require('./migrations/20260321_002_performance_indexes'),
  require('./migrations/20260325_001_add_conversation_status_enum'),
  require('./migrations/20260325_002_add_feature_tables'),
  require('./migrations/20260326_001_add_product_indexes'),
  require('./migrations/20260326_002_add_metadata_costcap'),
  require('./migrations/20260331_001_create_trx_id_logs'),
  require('./migrations/20260408_001_add_password_reset_tokens'),
  require('./migrations/20260414_001_add_user_token_version'),
  require('./migrations/20260418_001_add_conversation_resolution_fields'),
  require('./migrations/20260418_002_add_order_courier_fields'),
  require('./migrations/20260418_003_add_user_settings_and_last_shop'),
  require('./migrations/20260419_001_create_customer_delivery_stats'),
  require('./migrations/20260419_002_create_reconciliation_tables'),
  require('./migrations/20260423_001_channel_access_token_nullable'),
  require('./migrations/20260504_001_add_conversation_lookup_index'),
  require('./migrations/20260504_001_re_encrypt_meta_tokens'),
  require('./migrations/20260505_001_add_plan_code_to_subscriptions'),
  // 2026-05-10 major overhaul: conversation limits, top-up, platform priority
  require('./migrations/20260510_001_overhaul_subscription_plans'),
  require('./migrations/20260510_002_add_topup_and_conversation_log'),
  require('./migrations/20260510_003_shop_platform_priority'),
  // 2026-05-17 — beta-prep customer marketing opt-out
  require('./migrations/20260517_001_add_customer_marketing_opt_out'),
  // Meta integration redesign — Phase 1
  require('./migrations/20260520_001_create_meta_channels'),
  require('./migrations/20260520_002_remove_whatsapp_enums'),
  // Phase 2
  require('./migrations/20260524_001_reencrypt_meta_channel_tokens'),
  // Phase 3
  require('./migrations/20260527_001_create_policy_decisions'),
  // Phase 4
  require('./migrations/20260603_001_create_comment_to_dm_events'),
  // Phase 5 — cutover (DESTRUCTIVE, IRREVERSIBLE)
  require('./migrations/20260610_001_drop_legacy_channel_tables'),
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
