/**
 * Migration: Add billing_period_start and billing_period_end to invoices
 *
 * Purpose: Fix P0 duplicate invoice generation bug.
 * Backward Compatibility: YES
 * Rollback: Columns are additive — remove manually if needed.
 */

module.exports = {
  name: '20260218_003_add_invoice_period_dates',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();

    // Check table exists
    let tableExists = false;
    if (dialect === 'sqlite') {
      const [tables] = await sequelize.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'`
      );
      tableExists = tables.length > 0;
    } else {
      const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = 'invoices'`
      );
      tableExists = parseInt(rows[0].cnt, 10) > 0;
    }

    if (!tableExists) {
      console.log('  ⏭  invoices table does not exist yet, skipping');
      return;
    }

    // Check if columns already exist (idempotent)
    let colNames = [];
    if (dialect === 'sqlite') {
      const [cols] = await sequelize.query(`PRAGMA table_info('invoices')`);
      colNames = cols.map(c => c.name);
    } else {
      const [cols] = await sequelize.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices'`
      );
      colNames = cols.map(c => c.column_name);
    }

    if (!colNames.includes('billing_period_start')) {
      await sequelize.query(
        `ALTER TABLE invoices ADD COLUMN billing_period_start TIMESTAMPTZ`
      );
      console.log('  ✓ Added billing_period_start column to invoices');
    } else {
      console.log('  ⏭  billing_period_start already exists');
    }

    if (!colNames.includes('billing_period_end')) {
      await sequelize.query(
        `ALTER TABLE invoices ADD COLUMN billing_period_end TIMESTAMPTZ`
      );
      console.log('  ✓ Added billing_period_end column to invoices');
    } else {
      console.log('  ⏭  billing_period_end already exists');
    }

    // Composite index for duplicate-check query in checkExistingInvoice()
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_subscription_period
      ON invoices(subscription_id, billing_period_start)
    `);

    console.log('  ✓ Invoice duplicate-prevention now active (billing period date columns added)');
  },

  down: async (sequelize) => {
    console.log('  ⚠️  Rollback skipped: billing_period_start/end are additive columns.');
    console.log('      Remove manually via table recreation if truly needed.');
  }
};
