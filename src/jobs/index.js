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
// Phase 5: token-refresh-check.job.js deleted (replaced by meta-token-refresh.job.js Phase 2)
const MetaTokenRefreshJob = require('./meta-token-refresh.job');
const CourierReconciliationJob = require('./courier-reconciliation.job');
// Phase 4 — Comment-to-DM worker and expiry cron
const CommentToDmWorker = require('./comment-to-dm.worker');
const CommentToDmExpiryJob = require('./comment-to-dm-expiry.job');

module.exports = {
    DailyOverageCalculator,
    MonthlyUsageReset,
    InvoiceGenerator,
    FailedPaymentReconciler,
    MetaTokenRefreshJob,
    CourierReconciliationJob,
    // Phase 4
    CommentToDmWorker,
    CommentToDmExpiryJob,
};
