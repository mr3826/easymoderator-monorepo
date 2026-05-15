/**
 * Job Registry
 * 
 * Central registry for all scheduled jobs.
 * Import and export all job classes for easy access.
 */

const DailyOverageCalculator = require('./daily-overage-calculator');
const MonthlyUsageReset = require('./monthly-usage-reset');
const InvoiceGenerator = require('./invoice-generator');
const FailedPaymentReconciler = require('./failed-payment-reconciler');
const TokenRefreshCheckJob = require('./token-refresh-check.job');
const GoogleSheetsSyncJob = require('./google-sheets-sync.job');
const CourierReconciliationJob = require('./courier-reconciliation.job');

module.exports = {
    DailyOverageCalculator,
    MonthlyUsageReset,
    InvoiceGenerator,
    FailedPaymentReconciler,
    TokenRefreshCheckJob,
    GoogleSheetsSyncJob,
    CourierReconciliationJob
};
