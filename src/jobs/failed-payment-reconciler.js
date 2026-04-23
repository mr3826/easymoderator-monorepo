const BaseJob = require('./base-job');
const { Invoice, Subscription, Shop } = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { Op } = require('sequelize');
const emailService = require('../utils/email.service');

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

                // Send billing failure reminder via Nodemailer (email.service.js)
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
     * Send dunning email to shop owner.
     * Silently skips if shop has no email or SMTP is not configured.
     */
    async sendReminderNotification(invoice, action) {
        const shopEmail = invoice.shop?.email;
        const shopName = invoice.shop?.name || 'Shop';
        const invoiceNumber = invoice.invoice_number;
        const amount = parseFloat(invoice.amount).toLocaleString();
        const dueDate = new Date(invoice.due_date).toLocaleDateString('en-BD', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
        const billingUrl = `${process.env.FRONTEND_URL}/app/subscription`;

        if (!shopEmail) {
            this.logger.warn(`Shop ${invoice.shop_id} has no email — skipping dunning notification`);
            return;
        }

        const isSuspended = action === 'suspended';

        const subject = isSuspended
            ? 'Your Easy Moderator subscription has been suspended'
            : `Payment Reminder: Invoice ${invoiceNumber} is overdue`;

        const ctaColor = isSuspended ? '#dc2626' : '#2563eb';
        const ctaLabel = isSuspended ? 'Pay Now to Restore Access' : 'Pay Invoice';
        const bodyHeading = isSuspended
            ? 'Your subscription has been <strong>suspended</strong> due to non-payment.'
            : 'This is a reminder that your invoice is overdue.';
        const footerNote = isSuspended
            ? 'If you believe this is an error, please contact support immediately.'
            : 'Subscriptions unpaid for 30 days will be suspended.';

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:sans-serif;max-width:560px;margin:32px auto;color:#1f2937">
  <div style="background:#f9fafb;border-radius:8px;padding:32px;border:1px solid #e5e7eb">
    <h2 style="margin-top:0;color:${ctaColor}">${subject}</h2>
    <p>Dear <strong>${shopName}</strong>,</p>
    <p>${bodyHeading}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#6b7280">Invoice</td><td style="padding:8px 0;font-weight:600">${invoiceNumber}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">Amount Due</td><td style="padding:8px 0;font-weight:600">৳${amount}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">Due Date</td><td style="padding:8px 0;font-weight:600">${dueDate}</td></tr>
    </table>
    <a href="${billingUrl}" style="display:inline-block;background:${ctaColor};color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;margin:8px 0">${ctaLabel}</a>
    <p style="font-size:13px;color:#6b7280;margin-top:24px">${footerNote}</p>
  </div>
</body></html>`;

        try {
            const result = await emailService.sendEmail({ to: shopEmail, subject, html });
            this.logger.info(`Dunning email ${result.sent ? 'sent' : 'skipped (SMTP not configured)'}`, {
                invoiceId: invoice.id,
                shopId: invoice.shop_id,
                action,
                to: shopEmail
            });
        } catch (error) {
            // Email failures must never break the reconciler — log and continue
            this.logger.warn(`Failed to send dunning email`, {
                invoiceId: invoice.id,
                shopId: invoice.shop_id,
                error: error.message
            });
        }
    }
}

module.exports = FailedPaymentReconciler;
