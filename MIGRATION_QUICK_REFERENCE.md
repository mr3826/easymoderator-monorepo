# 📋 Database Migration Quick Reference

## Commands

```bash
# Run all pending migrations
npm run migrate

# Check migration status
npm run migrate:status

# Rollback last migration
npm run migrate:down

# Rollback all migrations (DANGER!)
npm run migrate:down:all
```

## Migration Rules (MUST FOLLOW)

1. ✅ **Use migrations only** - No direct SQL scripts
2. ✅ **Backward compatible** - Don't break existing code
3. ✅ **Include rollback** - Every `up()` needs a `down()`
4. ✅ **Include indexes** - Optimize all queries

## Creating a New Migration

### Step 1: Create File

**Naming:** `YYYYMMDD_NNN_description.js`

**Example:** `20260123_003_add_user_phone.js`

```bash
touch src/database/migrations/20260123_003_add_user_phone.js
```

### Step 2: Write Migration

```javascript
/**
 * Migration: Add phone to users
 * 
 * Backward Compatibility: YES - adds optional column
 * 
 * Indexes:
 * - INDEX(phone) - Fast phone lookup
 */

module.exports = {
  name: '20260123_003_add_user_phone',
  
  up: async (sequelize) => {
    // Add column with DEFAULT for backward compatibility
    await sequelize.query(`
      ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL
    `);
    
    // Create index
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)
    `);
    
    console.log('  ✓ Added phone column to users');
    console.log('  ✓ Created phone index');
  },
  
  down: async (sequelize) => {
    // Drop index first
    await sequelize.query(`DROP INDEX IF EXISTS idx_users_phone`);
    
    // Drop column
    await sequelize.query(`ALTER TABLE users DROP COLUMN phone`);
    
    console.log('  ✓ Removed phone column from users');
  }
};
```

### Step 3: Register Migration

Edit [src/database/migrate.js](src/database/migrate.js):

```javascript
const migrations = [
  require('./migrations/20260123_001_create_usage_events_table'),
  require('./migrations/20260123_002_create_subscription_tables'),
  require('./migrations/20260123_003_add_user_phone'), // ← ADD HERE
];
```

### Step 4: Test

```bash
# Check status (should show new migration as pending)
npm run migrate:status

# Run migration
npm run migrate

# Verify it worked
npm run migrate:status

# Test rollback
npm run migrate:down

# Re-run migration
npm run migrate
```

## Index Guidelines

### Always Index

- ✅ Foreign keys
- ✅ WHERE clause columns
- ✅ JOIN columns
- ✅ ORDER BY columns
- ✅ Unique constraints

### Index Types

```sql
-- Unique index (enforces uniqueness)
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- Regular index (improves query speed)
CREATE INDEX idx_users_status ON users(status);

-- Composite index (for multi-column queries)
CREATE INDEX idx_orders_shop_status ON orders(shop_id, status);
```

### Index Naming

- `idx_<table>_<column>` - Single column
- `idx_<table>_<col1>_<col2>` - Composite
- `idx_<table>_<purpose>` - Purpose-based

## Backward Compatibility Checklist

### ✅ Safe Operations

```sql
-- Add optional column
ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL;

-- Add index
CREATE INDEX idx_users_avatar ON users(avatar);

-- Create new table
CREATE TABLE user_settings (...);
```

### ❌ Breaking Operations

```sql
-- ❌ Drop column (breaks queries)
ALTER TABLE users DROP COLUMN email;

-- ❌ Rename column (breaks all references)
ALTER TABLE users RENAME COLUMN email TO email_address;

-- ❌ Change type (breaks validation)
ALTER TABLE users ALTER COLUMN age TYPE TEXT;

-- ❌ Add required column (breaks INSERT)
ALTER TABLE users ADD COLUMN phone TEXT NOT NULL;
```

### Migration Strategy for Breaking Changes

```javascript
// Phase 1: Add new column
up: async (sequelize) => {
  await sequelize.query(`ALTER TABLE users ADD COLUMN full_name TEXT`);
  await sequelize.query(`UPDATE users SET full_name = first_name || ' ' || last_name`);
}

// Phase 2: (Later migration) Drop old columns
// After verifying application uses full_name
```

## Common Patterns

### Create Table

```javascript
up: async (sequelize) => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS table_name (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    )
  `);
  
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_table_name_name ON table_name(name)
  `);
}
```

### Add Column

```javascript
up: async (sequelize) => {
  await sequelize.query(`
    ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL
  `);
  
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)
  `);
}
```

### Modify Data

```javascript
up: async (sequelize) => {
  // Update existing records
  await sequelize.query(`
    UPDATE subscriptions 
    SET status = 'trial' 
    WHERE trial_ends_at > CURRENT_TIMESTAMP
  `);
}
```

## Troubleshooting

### "Table already exists"

**Cause:** Migration already ran but not recorded

**Fix:**
```sql
-- Check if table exists
SELECT name FROM sqlite_master WHERE type='table' AND name='table_name';

-- If exists, manually record migration
INSERT INTO migrations (name, executed_at) 
VALUES ('20260123_001_migration_name', DATETIME('now'));
```

### "Migration failed"

**Cause:** SQL syntax error or constraint violation

**Fix:**
```bash
# Check error message
npm run migrate

# Fix migration file
# Re-run migration
npm run migrate
```

### "Cannot rollback"

**Cause:** Rollback `down()` has errors

**Fix:**
```bash
# Check migration down() function
# Fix SQL statements
# Try rollback again
npm run migrate:down
```

## Production Deployment

### Pre-Deployment

```bash
# 1. Backup database
cp database.sqlite database.sqlite.backup

# 2. Test in staging
npm run migrate:status
npm run migrate

# 3. Verify
npm run migrate:status
```

### Deployment

```bash
# 1. Pull code
git pull origin main

# 2. Run migrations
npm run migrate

# 3. Verify
npm run migrate:status

# 4. Restart app
pm2 restart app
```

### Emergency Rollback

```bash
# Rollback migration
npm run migrate:down

# Or restore backup
cp database.sqlite.backup database.sqlite

# Restart app
pm2 restart app
```

## Files & Documentation

- **Main Runner:** [src/database/migrate.js](src/database/migrate.js)
- **Migrations:** [src/database/migrations/](src/database/migrations/)
- **Full Guide:** [src/database/MIGRATION_GUIDE.md](src/database/MIGRATION_GUIDE.md)
- **Summary:** [MIGRATION_SYSTEM_SUMMARY.md](MIGRATION_SYSTEM_SUMMARY.md)

## Current Migrations

1. **20260123_001_create_usage_events_table** - Usage tracking for billing
2. **20260123_002_create_subscription_tables** - Subscriptions & invoices

## Status: ✅ PRODUCTION READY

---

**Last Updated:** January 23, 2026  
**Total Migrations:** 2  
**Total Indexes:** 15
