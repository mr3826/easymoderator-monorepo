/**
 * Migration: Create subscription and invoice tables
 * 
 * Purpose: Enable SaaS subscription billing with usage-based pricing
 * 
 * Backward Compatibility: YES
 * - Creates new tables only
 * - No changes to existing tables
 * - Safe to run on existing databases
 * 
 * Indexes:
 * - UNIQUE(shop_id) on subscriptions - One subscription per shop
 * - UNIQUE(invoice_number) on invoices - Unique invoice numbering
 * - INDEX(subscription_id, status) - Fast invoice queries
 * - INDEX(shop_id, status) - Fast subscription queries
 * - INDEX(next_billing_date) - Billing job queries
 */

module.exports = {
  name: '20260123_002_create_subscription_tables',
  
  up: async (sequelize) => {
    // Create subscriptions table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        shop_id UUID NOT NULL,
        plan_name TEXT NOT NULL DEFAULT 'Free',
        plan_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        billing_cycle TEXT NOT NULL DEFAULT 'monthly',
        status TEXT NOT NULL DEFAULT 'active',
        conversations_limit INTEGER NOT NULL DEFAULT 100,
        orders_limit INTEGER NOT NULL DEFAULT 50,
        products_limit INTEGER NOT NULL DEFAULT 100,
        conversations_used INTEGER DEFAULT 0,
        orders_used INTEGER DEFAULT 0,
        products_used INTEGER DEFAULT 0,
        extra_conversations INTEGER DEFAULT 0,
        extra_charges DECIMAL(10,2) DEFAULT 0,
        features TEXT DEFAULT '{}',
        current_period_start TIMESTAMPTZ NOT NULL,
        current_period_end TIMESTAMPTZ NOT NULL,
        next_billing_date TIMESTAMPTZ NOT NULL,
        trial_ends_at TIMESTAMPTZ,
        usage_reset_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_subscriptions_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);
    
    // Create UNIQUE index on shop_id (one subscription per shop)
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_shop_id 
      ON subscriptions(shop_id)
    `);
    
    // Create index for status queries
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_status 
      ON subscriptions(status)
    `);
    
    // Create index for billing job queries
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing_date 
      ON subscriptions(next_billing_date)
    `);
    
    // Create index for usage queries (active subscriptions)
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_shop_status 
      ON subscriptions(shop_id, status)
    `);
    
    console.log('  ✓ Created subscriptions table');
    console.log('  ✓ Created shop_id unique index');
    console.log('  ✓ Created status index');
    console.log('  ✓ Created billing date index');
    console.log('  ✓ Created usage query index');
    
    // Create invoices table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        shop_id UUID NOT NULL,
        invoice_number TEXT NOT NULL,
        billing_period TEXT NOT NULL,
        invoice_type TEXT NOT NULL DEFAULT 'monthly_subscription',
        amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        base_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        extra_usage_amount DECIMAL(10,2) DEFAULT 0,
        addon_amount DECIMAL(10,2) DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        due_date TIMESTAMPTZ NOT NULL,
        paid_at TIMESTAMPTZ,
        payment_method TEXT,
        transaction_id TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_invoices_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
        CONSTRAINT fk_invoices_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);
    
    // Create UNIQUE index on invoice_number
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_number 
      ON invoices(invoice_number)
    `);
    
    // Create index for subscription invoice queries
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_subscription_status 
      ON invoices(subscription_id, status)
    `);
    
    // Create index for shop invoice queries
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_shop_status 
      ON invoices(shop_id, status)
    `);
    
    // Create index for payment reconciliation job queries (pending invoices past due)
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_status_due_date 
      ON invoices(status, due_date)
    `);
    
    // Create index for billing period queries (prevent duplicate invoices)
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_subscription_period 
      ON invoices(subscription_id, billing_period)
    `);
    
    console.log('  ✓ Created invoices table');
    console.log('  ✓ Created invoice_number unique index');
    console.log('  ✓ Created subscription-status index');
    console.log('  ✓ Created shop-status index');
    console.log('  ✓ Created status-due_date index');
    console.log('  ✓ Created subscription-period index');
  },
  
  down: async (sequelize) => {
    // Drop invoice indexes
    await sequelize.query(`DROP INDEX IF EXISTS idx_invoices_subscription_period`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_invoices_status_due_date`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_invoices_shop_status`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_invoices_subscription_status`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_invoices_invoice_number`);
    
    // Drop invoices table
    await sequelize.query(`DROP TABLE IF EXISTS invoices`);
    
    console.log('  ✓ Dropped invoices table and indexes');
    
    // Drop subscription indexes
    await sequelize.query(`DROP INDEX IF EXISTS idx_subscriptions_shop_status`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_subscriptions_next_billing_date`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_subscriptions_status`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_subscriptions_shop_id`);
    
    // Drop subscriptions table
    await sequelize.query(`DROP TABLE IF EXISTS subscriptions`);
    
    console.log('  ✓ Dropped subscriptions table and indexes');
  }
};
