const BaseJob = require('./base-job');
const { Subscription, Shop } = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { Op } = require('sequelize');

/**
 * Monthly Usage Reset Job
 * 
 * Resets usage counters for all subscriptions at the start of each billing cycle.
 * Runs on the 1st day of each month at 00:00 UTC.
 * 
 * IDEMPOTENT: Running multiple times for same month only resets once
 * RE-RUNNABLE: Can be re-run for specific months
 * 
 * Usage:
 *   const job = new MonthlyUsageReset();
 *   await job.execute({ dryRun: true, runDate: new Date('2026-02-01') });
 *   await job.execute({ dryRun: false }); // Reset for current month
 */
class MonthlyUsageReset extends BaseJob {
    constructor() {
        super('monthly_usage_reset');
    }

    /**
     * Generate execution ID based on month
     * @param {Date} runDate 
     */
    generateExecutionId(runDate) {
        const yearMonth = runDate.toISOString().substring(0, 7); // YYYY-MM
        return `${this.jobName}-${yearMonth}`;
    }

    /**
     * Run monthly usage reset
     * @param {Object} options 
     */
    async run({ dryRun, runDate, executionId }) {
        this.logger.info(`[${this.jobName}] Resetting usage counters`, { dryRun, runDate });

        const results = {
            subscriptionsProcessed: 0,
            subscriptionsReset: 0,
            subscriptionsSkipped: 0,
            resetDetails: []
        };

        // Process in batches of 100 — prevents OOM at 10k+ tenants
        const BATCH_SIZE = 100;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const subscriptions = await Subscription.findAll({
                where: { status: 'active' },
                limit: BATCH_SIZE,
                offset,
                order: [['id', 'ASC']], // stable ordering required for cursor pagination
                include: [{ model: Shop, as: 'shop', required: true }]
            });

            if (subscriptions.length < BATCH_SIZE) hasMore = false;
            offset += subscriptions.length;
            this.metrics.recordsProcessed += subscriptions.length;

            for (const subscription of subscriptions) {
                try {
                    if (this.isAlreadyReset(subscription, runDate) && !dryRun) {
                        this.logger.info(`Subscription already reset this month`, {
                            shopId: subscription.shop_id,
                            lastReset: subscription.usage_reset_at
                        });
                        results.subscriptionsSkipped++;
                        continue;
                    }

                    const usageSnapshot = {
                        shopId: subscription.shop_id,
                        shopName: subscription.shop?.name || 'Unknown',
                        conversationsUsed: subscription.conversations_used,
                        ordersUsed: subscription.orders_used,
                        productsUsed: subscription.products_used,
                        extraCharges: subscription.extra_charges
                    };

                    if (!dryRun) {
                        await this.resetSubscription(subscription, runDate);
                    }

                    results.subscriptionsReset++;
                    results.resetDetails.push(usageSnapshot);
                    this.metrics.recordsSucceeded++;

                } catch (error) {
                    this.logger.error(`Failed to reset subscription for shop ${subscription.shop_id}`, error);
                    this.metrics.recordsFailed++;
                    this.metrics.errors.push(`Shop ${subscription.shop_id}: ${error.message}`);
                }
            }
        }

        results.subscriptionsProcessed = offset;
        return results;
    }

    /**
     * Check if subscription already reset this month
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    isAlreadyReset(subscription, runDate) {
        if (!subscription.usage_reset_at) {
            return false;
        }

        const resetDate = new Date(subscription.usage_reset_at);
        const runMonth = runDate.getMonth();
        const runYear = runDate.getFullYear();
        const resetMonth = resetDate.getMonth();
        const resetYear = resetDate.getFullYear();

        return resetYear === runYear && resetMonth === runMonth;
    }

    /**
     * Reset subscription usage counters
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    async resetSubscription(subscription, runDate) {
        await subscription.update({
            conversations_used: 0,
            orders_used: 0,
            products_used: 0,
            extra_charges: 0,
            usage_reset_at: runDate,
            updated_at: new Date()
        });

        this.logger.info(`Reset subscription for shop ${subscription.shop_id}`, {
            shopId: subscription.shop_id,
            resetDate: runDate
        });
    }
}

module.exports = MonthlyUsageReset;
