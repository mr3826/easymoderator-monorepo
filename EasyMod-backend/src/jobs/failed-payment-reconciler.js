const BaseJob = require('./base-job');
const { Invoice, Subscription, Shop } = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { Op } = require('sequelize');
const emailService = require('../utils/email.service');
const cacheService = require('../utils/cache.service');

/**
 * Failed Payment Reconciler Job
 * 
 * Reconciles failed payments and updates subscription status accordingly.
 * Runs daily at 02:00 UTC to check for overdue invoices.
 * 
 * IDEMPOTENT: Running multiple times for same date processes same invoices
 * RE-RUNNABLE: Can be re-run for historical dates
 * 
 * Billing policy (founder spec): a recurring subscription invoice is issued on
 * the renewal date with a 3-day "due threshold" (due_date = issue + 3 days).
 * Once that window passes unpaid, the AI assistant must stop. So:
 * - Recurring invoice (monthly_subscription / partner_per_order) past due
 *     → suspend the subscription (isAiActive=false → AI auto-pauses; the manual
 *       inbox stays usable). Paying the invoice reactivates it.
 * - Optional one-off invoices (add-on packs, proration) NEVER suspend AI — they
 *   are discretionary purchases; we only send a reminder.
 * 
 * Usage:
 *   const job = new FailedPaymentReconciler();
 *   await job.execute({ dryRun: true });
 *   await job.execute({ dryRun: false });
 */
const RECURRING_INVOICE_TYPES = ['monthly_subscription', 'partner_per_order'];

class FailedPaymentReconciler extends BaseJob {
    constructor() {
        super('failed_payment_reconciler');
        // The 3-day grace is encoded in the invoice due_date (issue + 3 days);
        // once a recurring invoice is past due at all, AI is paused.
        this.GRACE_DAYS = 3;
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
            subscriptionsSuspended: 0,
            remindersSent: 0,
            details: []
        };

        // Get all pending/failed invoices
        const overdueInvoices = await this.getOverdueInvoices(runDate);

        this.metrics.recordsProcessed = overdueInvoices.length;

        for (const invoice of overdueInvoices) {
            try {
                const daysOverdue = this.calculateDaysOverdue(invoice.due_date, runDate);
                const isRecurring = RECURRING_INVOICE_TYPES.includes(invoice.invoice_type);

                const action = {
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoice_number,
                    shopId: invoice.shop_id,
                    shopName: invoice.shop?.name || 'Unknown',
                    amount: invoice.amount,
                    dueDate: invoice.due_date,
                    daysOverdue,
                    invoiceType: invoice.invoice_type,
                    action: 'none'
                };

                // The 3-day due window has already passed (due_date < runDate). For a
                // recurring renewal invoice that means the AI must stop now: suspend the
                // subscription (isAiActive → false). Paying the invoice reactivates it.
                // One-off / discretionary invoices (add-on packs, proration) never gate AI —
                // they only get a payment reminder.
                if (isRecurring) {
                    if (!dryRun) {
                        await this.suspendSubscription(invoice.subscription);
                    }
                    action.action = 'suspended';
                    results.subscriptionsSuspended++;
                } else {
                    action.action = 'reminder';
                }

                // Send the dunning / reminder email (Nodemailer via email.service.js)
                if (!dryRun) {
                    await this.sendReminderNotification(invoice, action.action);
                    await this.sendMerchantPaymentAlert(invoice, action.action, runDate);
                    results.remindersSent++;
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
                // Invoice.status ENUM is ('pending','paid','cancelled','overdue') —
                // only unpaid, non-cancelled invoices are dunned.
                status: {
                    [Op.in]: ['pending', 'overdue']
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

        // Bust cached subscription/limits so the suspended status is reflected
        // immediately (the AI worker reads status straight from the DB, but the
        // FE billing view + trackUsage limit math read through this cache).
        await cacheService.clearForShop(subscription.shop_id).catch(() => {});

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
            ? 'Pay this invoice to immediately restore your AI assistant. Your inbox and data are unaffected.'
            : 'Please clear this balance to keep your add-on conversations available.';

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

    async sendMerchantPaymentAlert(invoice, action, runDate = new Date()) {
        try {
            const merchantNotificationService = require('../modules/notification/merchant-notification.service');
            const { NOTIFICATION_EVENTS } = require('../modules/notification/notification-events');
            await merchantNotificationService.notifyShop(
                invoice.shop_id,
                NOTIFICATION_EVENTS.PAYMENT_SUBSCRIPTION_ISSUE,
                {
                    invoiceNumber: invoice.invoice_number,
                    issue: action === 'suspended'
                        ? 'Subscription suspended for overdue recurring invoice'
                        : 'Invoice payment is overdue',
                    amount: invoice.amount,
                    dueDate: invoice.due_date
                },
                {
                    dedupeKey: `${invoice.id}:${action}:${runDate.toISOString().split('T')[0]}`,
                    dedupeTtlSeconds: 24 * 60 * 60
                }
            );
        } catch (error) {
            this.logger.warn(`Failed to queue merchant payment alert`, {
                invoiceId: invoice.id,
                shopId: invoice.shop_id,
                error: error.message
            });
        }
    }
}

module.exports = FailedPaymentReconciler;
