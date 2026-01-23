const BaseJob = require('./base-job');
const { Invoice, Subscription, Shop } = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { Op } = require('sequelize');

/**
 * Failed Payment Reconciler Job
 * 
 * Reconciles failed payments and updates subscription status accordingly.
 * Runs daily at 02:00 UTC to check for overdue invoices.
 * 
 * IDEMPOTENT: Running multiple times for same date processes same invoices
 * RE-RUNNABLE: Can be re-run for historical dates
 * 
 * Actions:
 * - Mark subscriptions as 'past_due' if invoice is 7+ days overdue
 * - Mark subscriptions as 'suspended' if invoice is 30+ days overdue
 * - Send reminder notifications (TODO: integrate with email service)
 * 
 * Usage:
 *   const job = new FailedPaymentReconciler();
 *   await job.execute({ dryRun: true });
 *   await job.execute({ dryRun: false });
 */
class FailedPaymentReconciler extends BaseJob {
    constructor() {
        super('failed_payment_reconciler');
        this.PAST_DUE_DAYS = 7;
        this.SUSPENSION_DAYS = 30;
    }

    /**
     * Run payment reconciliation
     * @param {Object} options 
     */
    async run({ dryRun, runDate, executionId }) {
        this.logger.info(`[${this.jobName}] Reconciling failed payments`, { dryRun, runDate });

        const results = {
            invoicesProcessed: 0,
            invoicesOverdue: 0,
            subscriptionsPastDue: 0,
            subscriptionsSuspended: 0,
            details: []
        };

        // Get all pending/failed invoices
        const overdueInvoices = await this.getOverdueInvoices(runDate);

        this.metrics.recordsProcessed = overdueInvoices.length;

        for (const invoice of overdueInvoices) {
            try {
                const daysOverdue = this.calculateDaysOverdue(invoice.due_date, runDate);

                const action = {
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoice_number,
                    shopId: invoice.shop_id,
                    shopName: invoice.shop?.name || 'Unknown',
                    amount: invoice.amount,
                    dueDate: invoice.due_date,
                    daysOverdue,
                    action: 'none'
                };

                // Determine action based on days overdue
                if (daysOverdue >= this.SUSPENSION_DAYS) {
                    // Suspend subscription
                    if (!dryRun) {
                        await this.suspendSubscription(invoice.subscription);
                    }
                    action.action = 'suspended';
                    results.subscriptionsSuspended++;

                } else if (daysOverdue >= this.PAST_DUE_DAYS) {
                    // Mark as past due
                    if (!dryRun) {
                        await this.markPastDue(invoice.subscription);
                    }
                    action.action = 'past_due';
                    results.subscriptionsPastDue++;
                }

                // Send reminder notification (TODO: implement email service)
                if (!dryRun && action.action !== 'none') {
                    await this.sendReminderNotification(invoice, action.action);
                }

                results.invoicesOverdue++;
                results.details.push(action);
                this.metrics.recordsSucceeded++;

            } catch (error) {
                this.logger.error(`Failed to reconcile invoice ${invoice.id}`, error);
                this.metrics.recordsFailed++;
                this.metrics.errors.push(`Invoice ${invoice.invoice_number}: ${error.message}`);
            }
        }

        results.invoicesProcessed = overdueInvoices.length;

        return results;
    }

    /**
     * Get overdue invoices
     * @param {Date} runDate 
     */
    async getOverdueInvoices(runDate) {
        const invoices = await Invoice.findAll({
            where: {
                status: {
                    [Op.in]: ['pending', 'failed']
                },
                due_date: {
                    [Op.lt]: runDate
                }
            },
            include: [
                {
                    model: Subscription,
                    as: 'subscription',
                    required: true
                },
                {
                    model: Shop,
                    as: 'shop',
                    required: true
                }
            ],
            order: [['due_date', 'ASC']]
        });

        return invoices;
    }

    /**
     * Calculate days overdue
     * @param {Date} dueDate 
     * @param {Date} currentDate 
     */
    calculateDaysOverdue(dueDate, currentDate) {
        const diffTime = currentDate - new Date(dueDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return Math.max(0, diffDays);
    }

    /**
     * Mark subscription as past due
     * @param {Object} subscription 
     */
    async markPastDue(subscription) {
        if (subscription.status === 'past_due') {
            return; // Already marked
        }

        await subscription.update({
            status: 'past_due',
            updated_at: new Date()
        });

        this.logger.info(`Marked subscription as past_due`, {
            subscriptionId: subscription.id,
            shopId: subscription.shop_id
        });
    }

    /**
     * Suspend subscription
     * @param {Object} subscription 
     */
    async suspendSubscription(subscription) {
        if (subscription.status === 'suspended') {
            return; // Already suspended
        }

        await subscription.update({
            status: 'suspended',
            updated_at: new Date()
        });

        this.logger.info(`Suspended subscription`, {
            subscriptionId: subscription.id,
            shopId: subscription.shop_id
        });
    }

    /**
     * Send reminder notification
     * @param {Object} invoice 
     * @param {string} action 
     */
    async sendReminderNotification(invoice, action) {
        // TODO: Integrate with email service
        this.logger.info(`Reminder notification queued`, {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_number,
            shopId: invoice.shop_id,
            action,
            // Email details would go here
            to: invoice.shop?.email || 'shop-owner@example.com',
            subject: action === 'suspended' 
                ? 'Subscription Suspended - Payment Required'
                : 'Payment Reminder - Invoice Overdue',
            amount: invoice.amount,
            dueDate: invoice.due_date
        });

        // Example integration:
        // await emailService.send({
        //     to: invoice.shop.email,
        //     subject: '...',
        //     template: action === 'suspended' ? 'subscription-suspended' : 'payment-reminder',
        //     data: { invoice, shop: invoice.shop }
        // });
    }
}

module.exports = FailedPaymentReconciler;
