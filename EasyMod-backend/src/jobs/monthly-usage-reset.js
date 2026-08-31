const BaseJob = require('./base-job');
const { Subscription, Shop } = require('../modules/entities');
const { Op } = require('sequelize');

/**
 * Monthly Usage Reset Job
 * 
 * Resets usage counters for subscriptions whose recorded period has ended.
 * Runs daily; the subscription period record is the source of truth.
 * 
 * IDEMPOTENT: A period is reset only when usage_reset_at is before its start
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
     * Generate execution ID per daily run
     * @param {Date} runDate 
     */
    generateExecutionId(runDate) {
        return `${this.jobName}-${runDate.toISOString().substring(0, 10)}`;
    }

    /**
     * Run the period-boundary usage reset
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

        // Process in batches of 100 — prevents OOM at 10k+ tenants. Use a
        // cursor, not offset, because resetting a row removes it from the
        // expired-period result set during this run.
        const BATCH_SIZE = 100;
        let lastId = null;
        let processed = 0;
        let hasMore = true;

        while (hasMore) {
            const where = {
                current_period_end: { [Op.lte]: runDate }
            };
            if (lastId) where.id = { [Op.gt]: lastId };
            const subscriptions = await Subscription.findAll({
                where,
                limit: BATCH_SIZE,
                order: [['id', 'ASC']], // stable ordering required for cursor pagination
                include: [{ model: Shop, as: 'shop', required: true }]
            });

            if (subscriptions.length < BATCH_SIZE) hasMore = false;
            if (subscriptions.length) lastId = subscriptions[subscriptions.length - 1].id;
            processed += subscriptions.length;
            this.metrics.recordsProcessed += subscriptions.length;

            for (const subscription of subscriptions) {
                try {
                    if (!subscription.current_period_start || !subscription.current_period_end) {
                        this.logger.warn(`Skipping subscription with no billing period anchor`, {
                            shopId: subscription.shop_id,
                        });
                        results.subscriptionsSkipped++;
                        continue;
                    }

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
                        extraCharges: subscription.extra_charge
                    };

                    if (!dryRun) {
                        const reset = await this.resetSubscription(subscription, runDate);
                        if (!reset) {
                            results.subscriptionsSkipped++;
                            continue;
                        }
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

        results.subscriptionsProcessed = processed;
        return results;
    }

    /**
     * Check if the current period has already been reset
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    isAlreadyReset(subscription, runDate) {
        if (!subscription.usage_reset_at) {
            return false;
        }

        if (!subscription.current_period_start) return false;
        return new Date(subscription.usage_reset_at).getTime()
            >= new Date(subscription.current_period_start).getTime();
    }

    /**
     * Reset subscription usage counters
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    async resetSubscription(subscription, runDate) {
        const periodStart = new Date(subscription.current_period_start);
        const nextPeriodStart = new Date(subscription.current_period_end);
        if (Number.isNaN(periodStart.getTime()) || Number.isNaN(nextPeriodStart.getTime())) {
            throw new Error('Subscription billing period is invalid');
        }

        const billingCycle = subscription.billing_cycle === 'yearly' ? 'yearly' : 'monthly';
        let nextPeriodEnd = advancePeriod(nextPeriodStart, billingCycle);

        const applyReset = async (target, transaction = null) => {
            const values = {
                conversations_used: 0,
                orders_used: 0,
                products_used: 0,
                // Keep the prior period start as the strict idempotency marker. It
                // remains below the newly advanced current_period_start, so the
                // next expired period can reset exactly once.
                current_period_start: nextPeriodStart,
                current_period_end: nextPeriodEnd,
                next_billing_date: nextPeriodEnd,
                usage_reset_at: periodStart,
                updated_at: new Date()
            };
            if (transaction) await target.update(values, { transaction });
            else await target.update(values);
        };

        // Metering locks the subscription row. Re-read the same period under the
        // lock so a concurrent reset cannot overwrite a new-period increment or
        // reset the same boundary twice.
        if (typeof Subscription.findOne !== 'function') {
            await applyReset(subscription);
        } else {
            const { sequelize } = require('../utils/database/database-setup');
            const reset = await sequelize.transaction(async (transaction) => {
                const locked = await Subscription.findOne({
                    where: {
                        id: subscription.id,
                        current_period_start: subscription.current_period_start,
                        current_period_end: subscription.current_period_end,
                    },
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });
                if (!locked) return false;
                await applyReset(locked, transaction);
                return true;
            });
            if (!reset) return false;
        }

        this.logger.info(`Reset subscription for shop ${subscription.shop_id}`, {
            shopId: subscription.shop_id,
            resetDate: runDate
        });
        return true;
    }
}

/** Advance a period in UTC while clamping dates such as January 31 to the
 * final day of the target month. */
function advancePeriod(date, billingCycle) {
    const next = new Date(date);
    const day = next.getUTCDate();
    next.setUTCDate(1);
    if (billingCycle === 'yearly') next.setUTCFullYear(next.getUTCFullYear() + 1);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
    return next;
}

module.exports = MonthlyUsageReset;
module.exports.advancePeriod = advancePeriod;
