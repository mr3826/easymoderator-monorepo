const Queue = require('bull');
const config = require('../config/config');

// Import job classes
const { 
    DailyOverageCalculator,
    MonthlyUsageReset,
    InvoiceGenerator,
    FailedPaymentReconciler 
} = require('./index');

/**
 * Job Queue Manager using Bull
 * Manages scheduled jobs with Redis as queue backend
 */
class QueueManager {
    constructor() {
        this.queues = {};
        this.redisUrl = config.redisUrl;
        
        if (!this.redisUrl) {
            console.warn('⚠️  Redis not available - job queues disabled');
            return;
        }

        // Initialize queues
        this.initializeQueues();
    }

    /**
     * Initialize Bull queues for each job type.
     *
     * Fixes applied:
     *   1. Processors now call job.execute() (not .run()) so BaseJob's idempotency
     *      guard and audit logging are honoured on every queue execution.
     *   2. Exponential backoff retry (3 attempts, 5s / 25s / 125s delays).
     *   3. Failed jobs are retained (removeOnFail: 200) for post-mortem inspection —
     *      this is the DLQ. Failed jobs in Redis are inspectable via Bull Board or CLI.
     *   4. runDate is serialized to ISO string in the queue payload and deserialized
     *      back to Date on the worker side.
     */
    initializeQueues() {
        const redisConnection = this.buildBullRedisConfig();

        const baseQueueConfig = {
            redis: redisConnection,
            settings: {
                lockDuration: 300000, // 5 minutes — billing jobs can be slow at scale
                maxStalledCount: 2,
                stalledInterval: 30000
            },
            // Default job options: retry with exponential backoff, keep failures for DLQ
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 }, // 5s → 25s → 125s
                removeOnComplete: 100,
                removeOnFail: 200 // DLQ: keep last 200 failed jobs for inspection
            }
        };

        // Daily Overage Calculator Queue
        this.queues.dailyOverage = new Queue('daily-overage-calculator', baseQueueConfig);
        this.queues.dailyOverage.process(async (job) => {
            const calculator = new DailyOverageCalculator();
            return await calculator.execute({
                dryRun: job.data.dryRun,
                runDate: job.data.runDate ? new Date(job.data.runDate) : new Date()
            });
        });

        // Monthly Usage Reset Queue
        this.queues.monthlyReset = new Queue('monthly-usage-reset', baseQueueConfig);
        this.queues.monthlyReset.process(async (job) => {
            const reset = new MonthlyUsageReset();
            return await reset.execute({
                dryRun: job.data.dryRun,
                runDate: job.data.runDate ? new Date(job.data.runDate) : new Date()
            });
        });

        // Invoice Generator Queue
        this.queues.invoiceGenerator = new Queue('invoice-generator', baseQueueConfig);
        this.queues.invoiceGenerator.process(async (job) => {
            const generator = new InvoiceGenerator();
            return await generator.execute({
                dryRun: job.data.dryRun,
                runDate: job.data.runDate ? new Date(job.data.runDate) : new Date()
            });
        });

        // Failed Payment Reconciler Queue
        this.queues.paymentReconciler = new Queue('failed-payment-reconciler', baseQueueConfig);
        this.queues.paymentReconciler.process(async (job) => {
            const reconciler = new FailedPaymentReconciler();
            return await reconciler.execute({
                dryRun: job.data.dryRun,
                runDate: job.data.runDate ? new Date(job.data.runDate) : new Date()
            });
        });

        // Campaign Send Queue — one job per recipient, rate-limited to stay under Meta's 200/hr/page limit
        this.queues.campaignSend = new Queue('campaign-send', {
            ...baseQueueConfig,
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 }, // 2s → 4s → 8s
                removeOnComplete: 200,
                removeOnFail: 500
            },
            // 180 sends per hour per queue, safely below Meta's 200/hr page limit
            limiter: { max: 180, duration: 3600000 }
        });
        this.queues.campaignSend.process(async (job) => {
            const { processCampaignSend } = require('./campaign-sender.job');
            return await processCampaignSend(job);
        });

        // Push Notification Queue — fire-and-forget, no retries needed (expired subs auto-cleaned)
        this.queues.notifications = new Queue('notifications', {
            ...baseQueueConfig,
            defaultJobOptions: {
                attempts: 2,
                backoff: { type: 'fixed', delay: 3000 },
                removeOnComplete: 50,
                removeOnFail: 100
            },
            // Respect Meta + FCM rate limits: max 50 notification batches / 10s per queue
            limiter: { max: 50, duration: 10000 }
        });
        this.queues.notifications.process(async (job) => {
            const { sendPushToShop } = require('../services/push-notification.service');
            const { shopId, payload } = job.data;
            return await sendPushToShop(shopId, payload);
        });

        // Unified event listeners: log completions, surface DLQ-bound failures
        Object.entries(this.queues).forEach(([name, queue]) => {
            queue.on('completed', (job, result) => {
                console.log(`✅ Job ${name} #${job.id} completed`);
            });

            queue.on('failed', (job, err) => {
                const isTerminal = job.attemptsMade >= (job.opts.attempts || 1);
                if (isTerminal) {
                    // Final failure — job is now in the DLQ (failed set in Redis)
                    console.error(
                        `[DLQ] Job ${name} #${job.id} exhausted all retries after ` +
                        `${job.attemptsMade} attempts. Error: ${err.message}`
                    );
                    // Alert via Slack when DLQ overflows
                    QueueManager.sendSlackAlert(
                        `[DLQ] Job \`${name}\` #${job.id} exhausted all ${job.attemptsMade} retries.\n` +
                        `Error: \`${err.message}\``
                    ).catch(() => {});
                } else {
                    console.warn(
                        `⚠️  Job ${name} #${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`
                    );
                }
            });

            queue.on('stalled', (job) => {
                console.warn(`⚠️  Job ${name} #${job.id} stalled — will be retried`);
            });
        });

        console.log('✅ Job queues initialized with retry/backoff and DLQ');
    }

    buildBullRedisConfig() {
        if (!this.redisUrl) return null;

        try {
            const parsed = new URL(this.redisUrl);
            const configObj = {
                host: parsed.hostname,
                port: parsed.port ? parseInt(parsed.port, 10) : 6379,
                db: 0,
                // Bull requires subscriber/bclient Redis connections to allow
                // unlimited retries and no ready check override.
                maxRetriesPerRequest: null,
                enableReadyCheck: false
            };

            if (parsed.password) {
                configObj.password = decodeURIComponent(parsed.password);
            }

            if (parsed.protocol === 'rediss:') {
                configObj.tls = { rejectUnauthorized: false };
            }

            return configObj;
        } catch (error) {
            console.warn('⚠️  Invalid REDIS_URL for Bull queue:', error.message);
            return { host: 'localhost', port: 6379 };
        }
    }

    /**
     * Schedule recurring jobs with cron expressions
     */
    async scheduleJobs() {
        if (!this.redisUrl) {
            console.warn('⚠️  Cannot schedule jobs - Redis not available');
            return;
        }

        // Note: runDate is intentionally omitted from repeatable job payloads.
        // The processor uses new Date(job.data.runDate || Date.now()) so each
        // scheduled execution captures the actual wall-clock time of that run.

        // Daily Overage Calculator — every day at 00:00 UTC
        await this.queues.dailyOverage.add(
            { dryRun: false },
            { jobId: 'daily-overage-calculator', repeat: { cron: '0 0 * * *', tz: 'UTC' } }
        );

        // Monthly Usage Reset — 1st of each month at 00:00 UTC
        await this.queues.monthlyReset.add(
            { dryRun: false },
            { jobId: 'monthly-usage-reset', repeat: { cron: '0 0 1 * *', tz: 'UTC' } }
        );

        // Invoice Generator — 1st of each month at 01:00 UTC (after usage reset)
        await this.queues.invoiceGenerator.add(
            { dryRun: false },
            { jobId: 'invoice-generator', repeat: { cron: '0 1 1 * *', tz: 'UTC' } }
        );

        // Failed Payment Reconciler — every day at 02:00 UTC
        await this.queues.paymentReconciler.add(
            { dryRun: false },
            { jobId: 'failed-payment-reconciler', repeat: { cron: '0 2 * * *', tz: 'UTC' } }
        );

        console.log('✅ Scheduled jobs configured');
    }

    /**
     * Manually trigger a job
     * @param {string} jobName - Name of job to run
     * @param {object} options - Job options
     */
    async triggerJob(jobName, options = {}) {
        const queueMap = {
            'daily_overage_calculator': 'dailyOverage',
            'monthly_usage_reset': 'monthlyReset',
            'invoice_generator': 'invoiceGenerator',
            'failed_payment_reconciler': 'paymentReconciler'
        };

        const queueKey = queueMap[jobName];
        if (!queueKey || !this.queues[queueKey]) {
            throw new Error(`Unknown job: ${jobName}`);
        }

        const job = await this.queues[queueKey].add({
            dryRun: options.dryRun || false,
            runDate: options.runDate || new Date()
        }, {
            priority: 1,
            removeOnComplete: true
        });

        return job;
    }

    /**
     * Get queue statistics
     * @param {string} queueName 
     */
    async getQueueStats(queueName) {
        const queue = this.queues[queueName];
        if (!queue) return null;

        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount()
        ]);

        return { waiting, active, completed, failed, delayed };
    }

    /**
     * Clean up old jobs
     */
    async cleanup() {
        const promises = Object.values(this.queues).map(queue => 
            queue.clean(7 * 24 * 60 * 60 * 1000, 'completed') // 7 days
        );
        await Promise.all(promises);
        console.log('✅ Queue cleanup completed');
    }

    /**
     * Gracefully close all queues
     */
    async close() {
        const promises = Object.values(this.queues).map(queue => queue.close());
        await Promise.all(promises);
        console.log('Queue manager closed');
    }

    /**
     * Send a Slack alert via SLACK_ALERT_WEBHOOK_URL.
     * No-op if the env var is not set.
     */
    static async sendSlackAlert(text) {
        const url = process.env.SLACK_ALERT_WEBHOOK_URL;
        if (!url) return;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
    }
}

// Export singleton instance
const queueManager = new QueueManager();

module.exports = queueManager;
