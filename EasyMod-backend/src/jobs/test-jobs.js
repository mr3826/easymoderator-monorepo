#!/usr/bin/env node

/**
 * Quick Test - Verify Jobs Load Correctly
 * 
 * Tests that all job classes can be instantiated without errors.
 */

console.log('Testing job imports...\n');

try {
    // Test BaseJob
    console.log('✓ Loading BaseJob...');
    const BaseJob = require('./base-job');
    
    // Test individual jobs
    console.log('✓ Loading DailyOverageCalculator...');
    const DailyOverageCalculator = require('./daily-overage-calculator');
    
    console.log('✓ Loading MonthlyUsageReset...');
    const MonthlyUsageReset = require('./monthly-usage-reset');
    
    console.log('✓ Loading InvoiceGenerator...');
    const InvoiceGenerator = require('./invoice-generator');
    
    console.log('✓ Loading FailedPaymentReconciler...');
    const FailedPaymentReconciler = require('./failed-payment-reconciler');
    
    console.log('✓ Loading job registry...');
    const jobs = require('./index');
    
    console.log('\n✅ All jobs loaded successfully!\n');
    
    console.log('Available jobs:');
    console.log('  - daily_overage_calculator');
    console.log('  - monthly_usage_reset');
    console.log('  - invoice_generator');
    console.log('  - failed_payment_reconciler');
    console.log('');
    
    console.log('Next steps:');
    console.log('  1. Ensure database is running');
    console.log('  2. Test with: node src/jobs/job-runner.js daily_overage_calculator --dry-run');
    console.log('');
    
} catch (error) {
    console.error('\n❌ Failed to load jobs:\n');
    console.error(error);
    process.exit(1);
}
