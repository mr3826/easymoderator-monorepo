# 📅 Scheduled Jobs

Production-ready, idempotent, re-runnable scheduled jobs for subscription billing and maintenance.

---

## 📋 Available Jobs

### 1. Daily Overage Calculator
**File:** `daily-overage-calculator.js`  
**Schedule:** Daily at 00:00 UTC  
**Purpose:** Calculate and record overage charges for shops exceeding subscription limits

**Overage Rates:**
- Conversations: ৳2.5 per conversation over limit
- Orders: Free (for now)
- Products: Free (for now)

**Example:**
```bash
# Dry run (test without changes)
node src/jobs/job-runner.js daily_overage_calculator --dry-run

# Execute for real
node src/jobs/job-runner.js daily_overage_calculator

# Run for specific date
node src/jobs/job-runner.js daily_overage_calculator --date=2026-01-15
```

**Output:**
```json
{
  "status": "success",
  "result": {
    "shopsProcessed": 50,
    "shopsWithOverage": 12,
    "totalOverageAmount": 375.50,
    "overageDetails": [...]
  }
}
```

---

### 2. Monthly Usage Reset
**File:** `monthly-usage-reset.js`  
**Schedule:** 1st of month at 00:00 UTC  
**Purpose:** Reset usage counters for all subscriptions at start of billing cycle

**What Gets Reset:**
- `conversations_used` → 0
- `orders_used` → 0
- `products_used` → 0
- `extra_charges` → 0
- `usage_reset_at` → current date

**Example:**
```bash
# Dry run for next month
node src/jobs/job-runner.js monthly_usage_reset --dry-run --date=2026-02-01

# Execute reset for current month
node src/jobs/job-runner.js monthly_usage_reset

# Re-run for specific month (idempotent)
node src/jobs/job-runner.js monthly_usage_reset --date=2026-01-01
```

**Output:**
```json
{
  "status": "success",
  "result": {
    "subscriptionsProcessed": 50,
    "subscriptionsReset": 48,
    "subscriptionsSkipped": 2,
    "resetDetails": [...]
  }
}
```

---

### 3. Invoice Generator
**File:** `invoice-generator.js`  
**Schedule:** 1st of month at 01:00 UTC (after usage reset)  
**Purpose:** Generate monthly invoices for all active subscriptions

**Invoice Includes:**
- Base subscription fee
- Overage charges from previous month
- Tax (if applicable)
- 7-day payment due date

**Example:**
```bash
# Dry run (preview invoices)
node src/jobs/job-runner.js invoice_generator --dry-run

# Generate invoices for current month
node src/jobs/job-runner.js invoice_generator

# Generate for specific month
node src/jobs/job-runner.js invoice_generator --date=2026-02-01
```

**Output:**
```json
{
  "status": "success",
  "result": {
    "subscriptionsProcessed": 50,
    "invoicesGenerated": 48,
    "invoicesSkipped": 2,
    "totalInvoiceAmount": 24500.00,
    "invoiceDetails": [...]
  }
}
```

---

### 4. Failed Payment Reconciler
**File:** `failed-payment-reconciler.js`  
**Schedule:** Daily at 02:00 UTC  
**Purpose:** Reconcile overdue invoices and update subscription status

**Actions:**
- **7+ days overdue:** Mark subscription as `past_due`, send reminder
- **30+ days overdue:** Mark subscription as `suspended`, send final notice

**Example:**
```bash
# Dry run (see what would happen)
node src/jobs/job-runner.js failed_payment_reconciler --dry-run

# Execute reconciliation
node src/jobs/job-runner.js failed_payment_reconciler

# Run for specific date
node src/jobs/job-runner.js failed_payment_reconciler --date=2026-01-15
```

**Output:**
```json
{
  "status": "success",
  "result": {
    "invoicesProcessed": 15,
    "invoicesOverdue": 15,
    "subscriptionsPastDue": 10,
    "subscriptionsSuspended": 5,
    "details": [...]
  }
}
```

---

## 🔄 Cron Schedule Setup

Add to your cron configuration:

```cron
# Daily Overage Calculator - Every day at 00:00 UTC
0 0 * * * cd /path/to/server && node src/jobs/job-runner.js daily_overage_calculator >> /var/log/jobs/overage.log 2>&1

# Monthly Usage Reset - 1st of month at 00:00 UTC
0 0 1 * * cd /path/to/server && node src/jobs/job-runner.js monthly_usage_reset >> /var/log/jobs/reset.log 2>&1

# Invoice Generator - 1st of month at 01:00 UTC
0 1 1 * * cd /path/to/server && node src/jobs/job-runner.js invoice_generator >> /var/log/jobs/invoices.log 2>&1

# Failed Payment Reconciler - Every day at 02:00 UTC
0 2 * * * cd /path/to/server && node src/jobs/job-runner.js failed_payment_reconciler >> /var/log/jobs/reconcile.log 2>&1
```

---

## ✅ Job Guarantees

All jobs implement these guarantees:

### 1. Idempotent ✓
Running the same job multiple times for the same period produces the same result.

**Example:**
```bash
# First run - processes 50 subscriptions
node src/jobs/job-runner.js monthly_usage_reset --date=2026-02-01

# Second run - skips already processed (50 skipped)
node src/jobs/job-runner.js monthly_usage_reset --date=2026-02-01
```

### 2. Re-runnable ✓
Jobs can be re-run for historical dates to fix issues or reprocess data.

**Example:**
```bash
# Regenerate invoices for January 2026
node src/jobs/job-runner.js invoice_generator --date=2026-01-01
```

### 3. Audit Logged ✓
Every job execution is logged to `audit_logs` table with full metadata.

**Audit Log Fields:**
- `action`: `job:<job-name>` or `job:<job-name>:error`
- `resource_type`: `job`
- `resource_id`: Execution ID (e.g., `monthly_usage_reset-2026-02`)
- `metadata`: Full execution results, metrics, errors
- `created_at`: Execution timestamp

### 4. Metrics Emitted ✓
Jobs emit comprehensive metrics for monitoring.

**Metrics Tracked:**
- `duration_ms`: Execution time in milliseconds
- `records_processed`: Total records evaluated
- `records_succeeded`: Successfully processed
- `records_failed`: Failed to process
- `error_count`: Number of errors encountered

**Example Metrics:**
```json
{
  "job": "invoice_generator",
  "duration_ms": 4523,
  "records_processed": 50,
  "records_succeeded": 48,
  "records_failed": 2,
  "error_count": 2,
  "timestamp": "2026-01-23T01:05:23.456Z"
}
```

---

## 🧪 Testing Jobs

### Dry Run Mode

All jobs support `--dry-run` flag for safe testing:

```bash
# Test without making any changes
node src/jobs/job-runner.js daily_overage_calculator --dry-run
```

**Dry Run Behavior:**
- ✅ Reads all data from database
- ✅ Performs all calculations
- ✅ Emits metrics and logs
- ❌ Does NOT write to database
- ❌ Does NOT update records
- ❌ Does NOT send notifications

### Manual Execution

Execute jobs manually for specific dates:

```bash
# Run for past date
node src/jobs/job-runner.js monthly_usage_reset --date=2025-12-01

# Run for future date (testing)
node src/jobs/job-runner.js invoice_generator --date=2026-03-01 --dry-run
```

---

## 📊 Monitoring & Alerting

### Check Job Execution History

Query audit logs to see job execution history:

```sql
-- Recent job executions
SELECT 
    action,
    resource_id AS execution_id,
    metadata->>'$.metrics.recordsProcessed' AS processed,
    metadata->>'$.metrics.recordsSucceeded' AS succeeded,
    metadata->>'$.metrics.recordsFailed' AS failed,
    metadata->>'$.metrics.duration_ms' AS duration_ms,
    created_at
FROM audit_logs
WHERE action LIKE 'job:%'
ORDER BY created_at DESC
LIMIT 20;
```

### Failed Jobs

Check for failed job executions:

```sql
-- Failed jobs in last 7 days
SELECT 
    action,
    resource_id,
    metadata->>'$.error.message' AS error_message,
    created_at
FROM audit_logs
WHERE action LIKE 'job:%:error'
  AND created_at > DATE('now', '-7 days')
ORDER BY created_at DESC;
```

### Alert Thresholds

Set up alerts for:
- ❌ Job execution failures (action = `job:<name>:error`)
- ⚠️ High failure rates (>10% records failed)
- ⚠️ Long execution times (>60 seconds)
- ⚠️ No execution for expected schedule

---

## 🔧 Development

### Creating a New Job

1. **Extend BaseJob class:**

```javascript
const BaseJob = require('./base-job');

class MyCustomJob extends BaseJob {
    constructor() {
        super('my_custom_job');
    }

    async run({ dryRun, runDate, executionId }) {
        // Your job logic here
        const results = {
            recordsProcessed: 0,
            // ...
        };
        
        // Track metrics
        this.metrics.recordsProcessed = results.recordsProcessed;
        
        return results;
    }
}

module.exports = MyCustomJob;
```

2. **Register in index.js:**

```javascript
const MyCustomJob = require('./my-custom-job');

module.exports = {
    // ... existing jobs
    MyCustomJob
};
```

3. **Add to job-runner.js:**

```javascript
const JOB_MAP = {
    // ... existing jobs
    'my_custom_job': jobs.MyCustomJob
};
```

4. **Test with dry-run:**

```bash
node src/jobs/job-runner.js my_custom_job --dry-run
```

---

## 📝 Troubleshooting

### Job Not Running

**Check:**
1. Job runner has execute permissions: `chmod +x src/jobs/job-runner.js`
2. Database connection is available
3. Required entities are loaded
4. Cron service is running: `systemctl status cron`

### Duplicate Executions

**Solution:**
Jobs are idempotent by design. Check audit logs:

```sql
SELECT COUNT(*) 
FROM audit_logs 
WHERE action = 'job:monthly_usage_reset'
  AND resource_id = 'monthly_usage_reset-2026-02'
GROUP BY resource_id;
```

If count > 1, subsequent runs were skipped (check `status: 'skipped'` in result).

### Performance Issues

**Optimization Tips:**
1. Add database indexes on frequently queried fields
2. Batch process large datasets (chunk into groups of 100)
3. Use database transactions for bulk updates
4. Monitor metrics for slow execution times

---

## 📚 Related Documentation

- [ATOMIC_USAGE_TRACKING.md](../../ATOMIC_USAGE_TRACKING.md) - Usage tracking implementation
- [IMPLEMENTATION_SUMMARY.md](../../IMPLEMENTATION_SUMMARY.md) - Deployment guide
- [subscription.service.js](../modules/subscription/subscription.service.js) - Subscription logic

---

**Last Updated:** January 23, 2026  
**Version:** 1.0.0  
**Status:** Production Ready ✅
