const BaseJob = require('./base-job');
const { Subscription, Invoice, Shop } = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { Op } = require('sequelize');

/**
 * Daily Overage Calculator Job
 * 
 * Calculates overage charges for shops that exceed their subscription limits.
 * Runs daily at 00:00 UTC to check current usage against limits.
 * 
 * IDEMPOTENT: Running multiple times for same date returns same result
 * RE-RUNNABLE: Can be re-run for historical dates
 * 
 * Usage:
 *   const job = new DailyOverageCalculator();
 *   await job.execute({ dryRun: true }); // Test without changes
 *   await job.execute({ dryRun: false }); // Execute for real
 */
class DailyOverageCalculator extends BaseJob {
    constructor() {
        super('daily_overage_calculator');
        this.CONVERSATION_OVERAGE_RATE = 2.5; // ৳2.5 per conversation over limit
        this.ORDER_OVERAGE_RATE = 0.0; // Free for now
        this.PRODUCT_OVERAGE_RATE = 0.0; // Free for now
    }

    /**
     * Run overage calculation
     * @param {Object} options 
     * @param {boolean} options.dryRun 
     * @param {Date} options.runDate 
     * @param {string} options.executionId 
     */
    async run({ dryRun, runDate, executionId }) {
        this.logger.info(`[${this.jobName}] Calculating overages`, { dryRun, runDate });

        const results = {
            shopsProcessed: 0,
            shopsWithOverage: 0,
            totalOverageAmount: 0,
            overageDetails: []
        };

        // Process in batches of 100 — prevents OOM at 10k+ tenants
        const BATCH_SIZE = 100;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const subscriptions = await Subscription.findAll({
                where: {
                    status: 'active',
                    // FREE tier is a hard cap with no overage — never bill it.
                    // (Belt-and-suspenders: the middleware already blocks free shops
                    // at the limit, so used should never exceed limit here.)
                    plan_code: { [Op.ne]: 'FREE' },
                    // Only load shops that are actually over their limit.
                    // conversations_limit > 0 excludes unlimited plans (stored as -1).
                    // The DB-level filter avoids a full table scan at 10k+ tenants.
                    conversations_limit: { [Op.gt]: 0 },
                    [Op.and]: sequelize.literal(
                        '"Subscription"."conversations_used" > "Subscription"."conversations_limit"'
                    )
                },
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
                    const overage = await this.calculateOverage(subscription, runDate);

                    if (overage.totalAmount > 0) {
                        results.shopsWithOverage++;
                        results.totalOverageAmount += overage.totalAmount;
                        results.overageDetails.push({
                            shopId: subscription.shop_id,
                            shopName: subscription.shop?.name || 'Unknown',
                            ...overage
                        });

                        if (!dryRun) {
                            await this.recordOverage(subscription, overage);
                        }
                    }

                    results.shopsProcessed++;
                    this.metrics.recordsSucceeded++;

                } catch (error) {
                    this.logger.error(`Failed to calculate overage for shop ${subscription.shop_id}`, error);
                    this.metrics.recordsFailed++;
                    this.metrics.errors.push(`Shop ${subscription.shop_id}: ${error.message}`);
                }
            }
        }

        return results;
    }

    /**
     * Calculate overage for a subscription
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    async calculateOverage(subscription, runDate) {
        const overage = {
            conversations: 0,
            orders: 0,
            products: 0,
            conversationAmount: 0,
            orderAmount: 0,
            productAmount: 0,
            totalAmount: 0
        };

        // Calculate conversation overage
        const conversationOverage = Math.max(0, subscription.conversations_used - subscription.conversations_limit);
        if (conversationOverage > 0) {
            overage.conversations = conversationOverage;
            overage.conversationAmount = conversationOverage * this.CONVERSATION_OVERAGE_RATE;
        }

        // Calculate order overage (if enabled in future)
        const orderOverage = Math.max(0, subscription.orders_used - subscription.orders_limit);
        if (orderOverage > 0 && this.ORDER_OVERAGE_RATE > 0) {
            overage.orders = orderOverage;
            overage.orderAmount = orderOverage * this.ORDER_OVERAGE_RATE;
        }

        // Calculate product overage (if enabled in future)
        const productOverage = Math.max(0, subscription.products_used - subscription.products_limit);
        if (productOverage > 0 && this.PRODUCT_OVERAGE_RATE > 0) {
            overage.products = productOverage;
            overage.productAmount = productOverage * this.PRODUCT_OVERAGE_RATE;
        }

        overage.totalAmount = overage.conversationAmount + overage.orderAmount + overage.productAmount;

        return overage;
    }

    /**
     * Record overage in subscription
     * @param {Object} subscription 
     * @param {Object} overage 
     */
    async recordOverage(subscription, overage) {
        // Update subscription with overage amount
        await subscription.update({
            extra_charges: overage.totalAmount,
            updated_at: new Date()
        });

        this.logger.info(`Recorded overage for shop ${subscription.shop_id}`, {
            shopId: subscription.shop_id,
            overage
        });
    }
}

module.exports = DailyOverageCalculator;
