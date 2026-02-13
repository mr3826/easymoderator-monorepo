const Queue = require('bull');
const { getRedisClient } = require('src/utils/redis-client');
const config = require('src/config/config');

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
        this.redisClient = getRedisClient();
        
        if (!this.redisClient) {
            console.warn('⚠️  Redis not available - job queues disabled');
            return;
        }

        // Initialize queues
        this.initializeQueues();
    }

    /**
     * Initialize Bull queues for each job type
     */
    initializeQueues() {
        const redisConfig = {
            redis: config.redisUrl,
            settings: {
                lockDuration: 300000, // 5 minutes
                maxStalledCount: 2,
                stalledInterval: 30000
            }
        };

        // Daily Overage Calculator Queue
        this.queues.dailyOverage = new Queue('daily-overage-calculator', redisConfig);
        this.queues.dailyOverage.process(async (job) => {
            const calculator = new DailyOverageCalculator();
            return await calculator.run(job.data.dryRun, job.data.runDate);
        });

        // Monthly Usage Reset Queue
        this.queues.monthlyReset = new Queue('monthly-usage-reset', redisConfig);
        this.queues.monthlyReset.process(async (job) => {
            const reset = new MonthlyUsageReset();
            return await reset.run(job.data.dryRun, job.data.runDate);
        });

        // Invoice Generator Queue
        this.queues.invoiceGenerator = new Queue('invoice-generator', redisConfig);
        this.queues.invoiceGenerator.process(async (job) => {
            const generator = new InvoiceGenerator();
            return await generator.run(job.data.dryRun, job.data.runDate);
        });

        // Failed Payment Reconciler Queue
        this.queues.paymentReconciler = new Queue('failed-payment-reconciler', redisConfig);
        this.queues.paymentReconciler.process(async (job) => {
            const reconciler = new FailedPaymentReconciler();
            return await reconciler.run(job.data.dryRun, job.data.runDate);
        });

        // Setup event listeners for all queues
        Object.entries(this.queues).forEach(([name, queue]) => {
            queue.on('completed', (job, result) => {
                console.log(`✅ Job ${name} #${job.id} completed:`, result);
            });

            queue.on('failed', (job, err) => {
                console.error(`❌ Job ${name} #${job.id} failed:`, err.message);
            });

            queue.on('stalled', (job) => {
                console.warn(`⚠️  Job ${name} #${job.id} stalled`);
            });
        });

        console.log('✅ Job queues initialized');
    }

    /**
     * Schedule recurring jobs with cron expressions
     */
    async scheduleJobs() {
        if (!this.redisClient) {
            console.warn('⚠️  Cannot schedule jobs - Redis not available');
            return;
        }

        // Daily Overage Calculator - Every day at 00:00 UTC
        await this.queues.dailyOverage.add(
            { dryRun: false, runDate: new Date() },
            {
                jobId: 'daily-overage-calculator',
                repeat: { cron: '0 0 * * *', tz: 'UTC' },
                removeOnComplete: 100,
                removeOnFail: 50
            }
        );

        // Monthly Usage Reset - 1st of month at 00:00 UTC
        await this.queues.monthlyReset.add(
            { dryRun: false, runDate: new Date() },
            {
                jobId: 'monthly-usage-reset',
                repeat: { cron: '0 0 1 * *', tz: 'UTC' },
                removeOnComplete: 100,
                removeOnFail: 50
            }
        );

        // Invoice Generator - 1st of month at 01:00 UTC
        await this.queues.invoiceGenerator.add(
            { dryRun: false, runDate: new Date() },
            {
                jobId: 'invoice-generator',
                repeat: { cron: '0 1 1 * *', tz: 'UTC' },
                removeOnComplete: 100,
                removeOnFail: 50
            }
        );

        // Failed Payment Reconciler - Every day at 02:00 UTC
        await this.queues.paymentReconciler.add(
            { dryRun: false, runDate: new Date() },
            {
                jobId: 'failed-payment-reconciler',
                repeat: { cron: '0 2 * * *', tz: 'UTC' },
                removeOnComplete: 100,
                removeOnFail: 50
            }
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
}

// Export singleton instance
const queueManager = new QueueManager();

module.exports = queueManager;
