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
// Reliability — synthetic auto-reply pipeline canary + DLQ/backlog watchdog
const PipelineCanaryJob = require('./pipeline-canary.job');
// Pricing — expire 14-day GROWTH trials + send trial-ending nudges
const TrialExpiryJob = require('./trial-expiry.job');

module.exports = {
    DailyOverageCalculator,
    MonthlyUsageReset,
    InvoiceGenerator,
    FailedPaymentReconciler,
    MetaTokenRefreshJob,
    CourierReconciliationJob,
    PipelineCanaryJob,
    TrialExpiryJob,
};
