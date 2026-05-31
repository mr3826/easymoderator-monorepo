'use strict';

const { Queue, Worker } = require('bullmq');
const config = require('../config/config');
const { connection, messageQueue } = require('./message-queue');

const {
    DailyOverageCalculator,
    MonthlyUsageReset,
    InvoiceGenerator,
    FailedPaymentReconciler,
    MetaTokenRefreshJob,
    CommentToDmWorker,
    CommentToDmExpiryJob,
    PipelineCanaryJob,
} = require('./index');

class QueueManager {
    constructor() {
        this.queues = {};
        this.workers = {};

        if (!config.redisUrl && !config.redisHost) {
            console.warn('⚠️  Redis not available - job queues disabled');
            return;
        }

        this.initializeQueues();
    }

    initializeQueues() {
        const defaultJobOptions = {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }, // 5s → 25s → 125s
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 200 }, // DLQ: retain last 200 failed jobs
        };

        const billingQueues = [
            ['daily-overage-calculator', 'dailyOverage', DailyOverageCalculator],
            ['monthly-usage-reset', 'monthlyReset', MonthlyUsageReset],
            ['invoice-generator', 'invoiceGenerator', InvoiceGenerator],
            ['failed-payment-reconciler', 'paymentReconciler', FailedPaymentReconciler],
            // Phase 2 — refresh Meta channel tokens before they expire.
            ['meta-token-refresh', 'metaTokenRefresh', MetaTokenRefreshJob],
            // Phase 4 — Comment-to-DM expiry cron (daily sweep)
            ['comment-to-dm-expiry', 'commentToDmExpiry', CommentToDmExpiryJob],
            // Reliability — auto-reply pipeline canary (every 5 min, see scheduleJobs)
            ['pipeline-canary', 'pipelineCanary', PipelineCanaryJob],
        ];

        for (const [queueName, key, JobClass] of billingQueues) {
            this.queues[key] = new Queue(queueName, { connection, defaultJobOptions });
            this.workers[key] = new Worker(queueName, async (job) => {
                const instance = new JobClass();
                return instance.execute({
                    dryRun: job.data.dryRun,
                    runDate: job.data.runDate ? new Date(job.data.runDate) : new Date(),
                });
            }, { connection });
        }

        // Phase 4 — Comment-to-DM processing queue (separate from billing, separate from message-processing)
        this.queues.commentToDm = new Queue('comment-to-dm', {
            connection,
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { count: 500 },
                removeOnFail: { count: 200 },
            },
        });
        this.workers.commentToDm = new Worker('comment-to-dm', async (job) => {
            const worker = new CommentToDmWorker();
            return worker.execute(job);
        }, {
            connection,
            concurrency: 10,
        });

        // Push notification — fire-and-forget, expired subs auto-cleaned
        this.queues.notifications = new Queue('notifications', {
            connection,
            defaultJobOptions: {
                attempts: 2,
                backoff: { type: 'fixed', delay: 3000 },
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 100 },
            },
        });
        this.workers.notifications = new Worker('notifications', async (job) => {
            const { sendPushToShop } = require('../modules/notification/push-notification.service');
            return sendPushToShop(job.data.shopId, job.data.payload);
        }, {
            connection,
            limiter: { max: 50, duration: 10000 },
        });

        // Observability-only handles for the customer-facing reply pipeline.
        // The message-processing queue is the singleton created in message-queue.js
        // (and consumed by the worker started below); message-dlq is the sink that
        // message-worker.js writes dead-lettered jobs into. Registering references
        // here lets /health/detailed and getCriticalQueueStats() read their depths.
        // No worker is attached — message-dlq is intentionally a manual-drain sink.
        this.queues.messageProcessing = messageQueue;
        this.queues.messageDlq = new Queue('message-dlq', { connection });

        for (const [name, worker] of Object.entries(this.workers)) {
            worker.on('completed', (job) => {
                console.log(`✅ Job ${name} #${job.id} completed`);
            });

            worker.on('failed', (job, err) => {
                const isTerminal = job.attemptsMade >= (job.opts.attempts || 1);
                if (isTerminal) {
                    console.error(
                        `[DLQ] Job ${name} #${job.id} exhausted all retries after ` +
                        `${job.attemptsMade} attempts. Error: ${err.message}`
                    );
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

            worker.on('stalled', (jobId) => {
                console.warn(`⚠️  Job ${name} #${jobId} stalled — will be retried`);
            });
        }

        // Start the AI message-processing worker. Must be registered AFTER the generic
        // event-listener loop above so its own detailed listeners (set inside startWorker)
        // are not overridden by the generic ones.
        const { startWorker: startMessageProcessingWorker } = require('./message-worker');
        this.workers.messageProcessing = startMessageProcessingWorker();

        console.log('✅ Job queues initialized with BullMQ');
    }

    async scheduleJobs() {
        if (!config.redisUrl && !config.redisHost) {
            console.warn('⚠️  Cannot schedule jobs - Redis not available');
            return;
        }

        await this.queues.dailyOverage.upsertJobScheduler(
            'daily-overage-calculator',
            { pattern: '0 0 * * *', tz: 'UTC' },
            { name: 'run', data: { dryRun: false } }
        );

        await this.queues.monthlyReset.upsertJobScheduler(
            'monthly-usage-reset',
            { pattern: '0 0 1 * *', tz: 'UTC' },
            { name: 'run', data: { dryRun: false } }
        );

        await this.queues.invoiceGenerator.upsertJobScheduler(
            'invoice-generator',
            { pattern: '0 1 1 * *', tz: 'UTC' },
            { name: 'run', data: { dryRun: false } }
        );

        await this.queues.paymentReconciler.upsertJobScheduler(
            'failed-payment-reconciler',
            { pattern: '0 2 * * *', tz: 'UTC' },
            { name: 'run', data: { dryRun: false } }
        );

        // Phase 2 — refresh Meta tokens every 6 hours so they never expire silently.
        await this.queues.metaTokenRefresh.upsertJobScheduler(
            'meta-token-refresh',
            { pattern: '0 */6 * * *', tz: 'UTC' },
            { name: 'run', data: { dryRun: false } }
        );

        // Phase 4 — expire stale Comment-to-DM rows daily at 03:00 UTC.
        await this.queues.commentToDmExpiry.upsertJobScheduler(
            'comment-to-dm-expiry',
            { pattern: '0 3 * * *', tz: 'UTC' },
            { name: 'run', data: { dryRun: false } }
        );

        // Reliability — run the auto-reply pipeline canary every 5 minutes so a
        // down/wedged worker or a non-empty DLQ pages within one interval.
        await this.queues.pipelineCanary.upsertJobScheduler(
            'pipeline-canary',
            { pattern: '*/5 * * * *', tz: 'UTC' },
            { name: 'run', data: { dryRun: false } }
        );

        console.log('✅ Scheduled jobs configured');
    }

    async triggerJob(jobName, options = {}) {
        const queueMap = {
            'daily_overage_calculator': 'dailyOverage',
            'monthly_usage_reset': 'monthlyReset',
            'invoice_generator': 'invoiceGenerator',
            'failed_payment_reconciler': 'paymentReconciler',
            'meta_token_refresh': 'metaTokenRefresh',
            'comment_to_dm_expiry': 'commentToDmExpiry',
            'pipeline_canary': 'pipelineCanary',
        };

        const queueKey = queueMap[jobName];
        if (!queueKey || !this.queues[queueKey]) {
            throw new Error(`Unknown job: ${jobName}`);
        }

        return this.queues[queueKey].add('run', {
            dryRun: options.dryRun || false,
            runDate: options.runDate ? new Date(options.runDate).toISOString() : new Date().toISOString(),
        }, { priority: 1, removeOnComplete: true });
    }

    async getQueueStats(queueName) {
        const queue = this.queues[queueName];
        if (!queue) return null;

        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount(),
        ]);

        return { waiting, active, completed, failed, delayed };
    }

    /**
     * Stats for the CUSTOMER-FACING reply pipeline — the queues that actually
     * decide whether a buyer gets an answer. Surfaced by /health/detailed so the
     * reply path and its dead-letter queue are observable (previously only the
     * billing queues were). `dlq > 0` means messages failed every retry.
     */
    async getCriticalQueueStats() {
        const keys = ['messageProcessing', 'commentToDm', 'notifications', 'messageDlq'];
        const out = {};
        await Promise.all(keys.map(async (key) => {
            try {
                out[key] = (await this.getQueueStats(key)) || null;
            } catch (_) {
                out[key] = { error: 'unavailable' };
            }
        }));
        return out;
    }

    async cleanup() {
        await Promise.all(
            Object.values(this.queues).map(q => q.clean(7 * 24 * 60 * 60 * 1000, 1000, 'completed'))
        );
        console.log('✅ Queue cleanup completed');
    }

    async close() {
        await Promise.all([
            ...Object.values(this.workers).map(w => w.close()),
            ...Object.values(this.queues).map(q => q.close()),
        ]);
        console.log('Queue manager closed');
    }

    static async sendSlackAlert(text) {
        const url = process.env.SLACK_ALERT_WEBHOOK_URL;
        if (!url) return;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
    }
}

const queueManager = new QueueManager();
module.exports = queueManager;
