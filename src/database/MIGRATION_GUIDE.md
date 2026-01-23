# Database Migration System

## Overview

All schema changes **MUST** use migrations. Direct SQL scripts are prohibited in production.

## Migration Rules

1. ✅ **Use migrations only** - No direct `CREATE TABLE` scripts
2. ✅ **Backward compatible** - Existing data must remain accessible
3. ✅ **Include rollback scripts** - Every migration has a `down()` function
4. ✅ **Include indexes** - All queries must be optimized with indexes
5. ✅ **Idempotent** - Safe to run multiple times

## Commands

```bash
# Run all pending migrations
npm run migrate

# Rollback last migration
npm run migrate:down

# Rollback all migrations (DANGER)
npm run migrate:down:all

# Show migration status
npm run migrate:status
```

## Migration Structure

Each migration file must export:

```javascript
module.exports = {
  name: '20260123_001_migration_name',
  
  up: async (sequelize) => {
    // Apply schema changes
    await sequelize.query(`CREATE TABLE ...`);
    await sequelize.query(`CREATE INDEX ...`);
  },
  
  down: async (sequelize) => {
    // Rollback schema changes (reverse order)
    await sequelize.query(`DROP INDEX ...`);
    await sequelize.query(`DROP TABLE ...`);
  }
};
```

## Creating New Migrations

### 1. Create Migration File

Create file: `src/database/migrations/YYYYMMDD_NNN_description.js`

**Naming Convention:**
- `YYYYMMDD` - Date (e.g., 20260123)
- `NNN` - Sequence number (001, 002, etc.)
- `description` - Snake_case description

**Example:** `20260123_003_add_user_roles_table.js`

### 2. Implement Migration

```javascript
/**
 * Migration: Add user roles table
 * 
 * Purpose: Enable role-based access control
 * 
 * Backward Compatibility: YES
 * - Creates new table only
 * - No changes to existing tables
 * - Safe to run on existing databases
 * 
 * Indexes:
 * - UNIQUE(user_id, shop_id) - One role per user per shop
 * - INDEX(role) - Fast role queries
 */

module.exports = {
  name: '20260123_003_add_user_roles_table',
  
  up: async (sequelize) => {
    // Create table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);
    
    // Create indexes
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_user_shop 
      ON user_roles(user_id, shop_id)
    `);
    
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_user_roles_role 
      ON user_roles(role)
    `);
    
    console.log('  ✓ Created user_roles table');
    console.log('  ✓ Created indexes');
  },
  
  down: async (sequelize) => {
    // Drop indexes first
    await sequelize.query(`DROP INDEX IF EXISTS idx_user_roles_role`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_user_roles_user_shop`);
    
    // Drop table
    await sequelize.query(`DROP TABLE IF EXISTS user_roles`);
    
    console.log('  ✓ Dropped user_roles table and indexes');
  }
};
```

### 3. Register Migration

Add to `src/database/migrate.js`:

```javascript
const migrations = [
  require('./migrations/20260123_001_create_usage_events_table'),
  require('./migrations/20260123_002_create_subscription_tables'),
  require('./migrations/20260123_003_add_user_roles_table'), // NEW
];
```

### 4. Test Migration

```bash
# Check current status
npm run migrate:status

# Run migration
npm run migrate

# Verify tables created
sqlite3 database.sqlite "SELECT name FROM sqlite_master WHERE type='table';"

# Test rollback
npm run migrate:down

# Re-run migration
npm run migrate
```

## Backward Compatibility Guidelines

### ✅ Safe Operations

- **CREATE TABLE** - New tables don't affect existing code
- **CREATE INDEX** - Improves performance, doesn't break queries
- **ADD COLUMN with DEFAULT** - Existing queries still work
- **ADD FOREIGN KEY with ON DELETE CASCADE** - Maintains referential integrity

Example:
```sql
-- Safe: Add optional column
ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL;

-- Safe: Add index
CREATE INDEX idx_users_email ON users(email);
```

### ❌ Breaking Operations (Require Migration Strategy)

- **DROP COLUMN** - Breaks queries using that column
- **RENAME COLUMN** - Breaks all references
- **CHANGE COLUMN TYPE** - May break data validation
- **ADD COLUMN without DEFAULT** - Breaks INSERT statements
- **DROP TABLE** - Breaks all code using that table

**Migration Strategy:**
```javascript
// Step 1: Add new column
await sequelize.query(`ALTER TABLE users ADD COLUMN full_name TEXT`);

// Step 2: Migrate data
await sequelize.query(`UPDATE users SET full_name = first_name || ' ' || last_name`);

// Step 3: (Future migration) Drop old columns after verifying full_name usage
// await sequelize.query(`ALTER TABLE users DROP COLUMN first_name`);
```

## Index Best Practices

### Required Indexes

1. **Primary Keys** - Already indexed by default
2. **Foreign Keys** - Index all foreign key columns
3. **Unique Constraints** - Create unique indexes for business rules
4. **WHERE Clauses** - Index columns frequently used in WHERE
5. **JOIN Columns** - Index columns used in JOIN conditions
6. **ORDER BY Columns** - Index columns used in sorting

### Index Examples

```javascript
// Idempotency enforcement
CREATE UNIQUE INDEX idx_usage_events_idempotency 
ON usage_events(shop_id, resource_type, request_id);

// Fast filtering
CREATE INDEX idx_subscriptions_status 
ON subscriptions(status);

// Composite index for complex queries
CREATE INDEX idx_invoices_shop_status 
ON invoices(shop_id, status);

// Date range queries
CREATE INDEX idx_audit_logs_created_at 
ON audit_logs(created_at);
```

### Index Naming Convention

- **Unique indexes:** `idx_<table>_<column1>_<column2>`
- **Regular indexes:** `idx_<table>_<purpose>` or `idx_<table>_<column>`

## Rollback Strategy

### When to Rollback

- Migration fails mid-execution
- Production issues discovered after deployment
- Schema change breaks existing functionality
- Data corruption detected

### Rollback Commands

```bash
# Rollback last migration only
npm run migrate:down

# Check what will be rolled back
npm run migrate:status

# Nuclear option: rollback everything (DANGER)
npm run migrate:down:all
```

### Rollback Safety

- Always test rollback in development first
- Verify data integrity after rollback
- Have backups before production rollbacks
- Document rollback procedures in migration comments

## Migration Checklist

Before creating a migration:

- [ ] Migration follows naming convention
- [ ] Both `up()` and `down()` implemented
- [ ] Backward compatible changes only
- [ ] All indexes included
- [ ] Foreign keys have CASCADE rules
- [ ] Migration is idempotent (CREATE IF NOT EXISTS)
- [ ] Documentation comment included
- [ ] Tested locally with `npm run migrate`
- [ ] Tested rollback with `npm run migrate:down`
- [ ] Registered in `migrate.js`

## Existing Migrations

### 20260123_001_create_usage_events_table

**Purpose:** Track subscription usage increments

**Tables:** `usage_events`

**Indexes:**
- `idx_usage_events_idempotency (shop_id, resource_type, request_id)` - UNIQUE
- `idx_usage_events_shop_status (shop_id, status)`
- `idx_usage_events_created_at (created_at)`
- `idx_usage_events_resource_type (resource_type)`

**Queries Optimized:**
- `SELECT * FROM usage_events WHERE shop_id = ? AND status = 'committed'`
- `SELECT * FROM usage_events WHERE created_at > ?`
- `SELECT * FROM usage_events WHERE resource_type = ?`

### 20260123_002_create_subscription_tables

**Purpose:** Enable SaaS subscription billing

**Tables:** `subscriptions`, `invoices`

**Indexes:**
- `idx_subscriptions_shop_id (shop_id)` - UNIQUE
- `idx_subscriptions_status (status)`
- `idx_subscriptions_next_billing_date (next_billing_date)`
- `idx_subscriptions_shop_status (shop_id, status)`
- `idx_invoices_invoice_number (invoice_number)` - UNIQUE
- `idx_invoices_subscription_status (subscription_id, status)`
- `idx_invoices_shop_status (shop_id, status)`
- `idx_invoices_status_due_date (status, due_date)`
- `idx_invoices_subscription_period (subscription_id, billing_period)`

**Queries Optimized:**
- `SELECT * FROM subscriptions WHERE shop_id = ?`
- `SELECT * FROM subscriptions WHERE next_billing_date <= CURRENT_DATE`
- `SELECT * FROM invoices WHERE subscription_id = ? AND status = 'pending'`
- `SELECT * FROM invoices WHERE status = 'pending' AND due_date < CURRENT_DATE`

## Deprecating Old Scripts

**DEPRECATED:** `src/scripts/create-subscription-tables.js`

**Reason:** Direct table creation bypasses migration system

**Replacement:** Use `npm run migrate` instead

**Migration Path:**
```bash
# Old way (DEPRECATED)
node src/scripts/create-subscription-tables.js

# New way (REQUIRED)
npm run migrate
```

## Production Deployment

### Pre-Deployment

1. Backup database
2. Test migrations in staging environment
3. Verify rollback works in staging
4. Review migration status: `npm run migrate:status`

### Deployment Steps

```bash
# 1. Pull latest code
git pull origin main

# 2. Run migrations
npm run migrate

# 3. Verify migration status
npm run migrate:status

# 4. Restart application
pm2 restart app
```

### Post-Deployment

1. Verify application functionality
2. Check error logs
3. Monitor database performance
4. Test critical user flows

### Emergency Rollback

```bash
# 1. Rollback last migration
npm run migrate:down

# 2. Restart application
pm2 restart app

# 3. Investigate issue
npm run migrate:status
```

## Questions & Troubleshooting

### Q: Migration fails with "table already exists"

**A:** Migration is already applied. Check status:
```bash
npm run migrate:status
```

If migration shows as not executed but table exists, manually insert migration record:
```sql
INSERT INTO migrations (name, executed_at) 
VALUES ('20260123_001_create_usage_events_table', DATETIME('now'));
```

### Q: How to modify an existing table?

**A:** Create a new migration with ALTER TABLE:
```javascript
up: async (sequelize) => {
  await sequelize.query(`ALTER TABLE users ADD COLUMN phone TEXT`);
}
```

### Q: Can I delete old migrations?

**A:** No. Migrations are permanent historical records. Never delete executed migrations.

### Q: How to seed data after migration?

**A:** Create a separate seed script or add data in migration:
```javascript
up: async (sequelize) => {
  await sequelize.query(`CREATE TABLE ...`);
  await sequelize.query(`INSERT INTO default_roles ...`);
}
```

## Support

For migration issues:
1. Check migration status: `npm run migrate:status`
2. Review migration logs
3. Test rollback in development
4. Consult this documentation
