/**
 * Migration: Add billing_period_start and billing_period_end to invoices
 *
 * Purpose: Fix P0 duplicate invoice generation bug.
 *   invoice-generator.js checkExistingInvoice() queries billing_period_start and
 *   billing_period_end columns that do not exist in the Invoice entity/table.
 *   Every run returns null from the check → duplicate invoices generated every time.
 *
 * After this migration + entity update:
 *   - InvoiceGenerator.createInvoice() persists billing_period_start/end
 *   - checkExistingInvoice() correctly detects existing invoices for the period
 *   - Monthly invoice generation becomes truly idempotent
 *
 * Backward Compatibility: YES
 *   - ADD COLUMN with NULL default — existing rows get NULL (safe)
 *   - New invoices will populate both columns
 *   - Composite index added for efficient duplicate-check queries
 *
 * Rollback: DROP both columns (SQLite 3.35.0+ only) or accept as no-op
 */

module.exports = {
  name: '20260218_003_add_invoice_period_dates',

  up: async (sequelize) => {
    // Check table exists
    const [tables] = await sequelize.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'`
    );
    if (tables.length === 0) {
      console.log('  ⏭  invoices table does not exist yet, skipping');
      return;
    }

    // Check if columns already exist (idempotent)
    const [cols] = await sequelize.query(`PRAGMA table_info('invoices')`);
    const colNames = cols.map(c => c.name);

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
    // SQLite 3.35.0+ supports DROP COLUMN; older versions require table recreation.
    // For safety, log a warning and skip — these columns are additive and harmless.
    console.log('  ⚠️  Rollback skipped: billing_period_start/end are additive columns.');
    console.log('      Remove manually via table recreation if truly needed.');
  }
};
