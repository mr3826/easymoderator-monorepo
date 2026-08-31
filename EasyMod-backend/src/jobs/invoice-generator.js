const BaseJob = require('./base-job');
const { Subscription, Invoice, Shop, PartnerBillingAdjustment } = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { Op } = require('sequelize');
const crypto = require('crypto');
const {
    recurringInvoiceTypeFor,
    getPartnerOrderTier
} = require('../modules/subscription/subscription.plans');

/**
 * Invoice Generator Job
 * 
 * Generates renewal invoices for active paid subscriptions and month-end
 * Partner invoices. Shuru is free forever and is never invoiced.
 * Runs daily at 01:00 UTC; expired period markers and calendar Partner windows
 * make the run idempotent.
 * 
 * IDEMPOTENT: Running multiple times for same month won't create duplicate invoices
 * RE-RUNNABLE: Can be re-run for specific months to regenerate invoices
 * 
 * Usage:
 *   const job = new InvoiceGenerator();
 *   await job.execute({ dryRun: true, runDate: new Date('2026-02-01') });
 *   await job.execute({ dryRun: false }); // Generate for current month
 */
class InvoiceGenerator extends BaseJob {
    constructor() {
        super('invoice_generator');
    }

    /**
     * Generate execution ID based on run date. The job runs daily because plan
     * periods are anchored to signup/payment boundaries rather than the month.
     * @param {Date} runDate 
     */
    generateExecutionId(runDate) {
        const day = runDate.toISOString().substring(0, 10); // YYYY-MM-DD
        return `${this.jobName}-${day}`;
    }

    /**
     * Run invoice generation
     * @param {Object} options 
     */
    async run({ dryRun, runDate, executionId }) {
        this.logger.info(`[${this.jobName}] Generating invoices`, { dryRun, runDate });

        const results = {
            subscriptionsProcessed: 0,
            invoicesGenerated: 0,
            invoicesSkipped: 0,
            totalInvoiceAmount: 0,
            invoiceDetails: []
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
                    // Shuru has no recurring charge — never generate an invoice for it.
                    if (String(subscription.plan_code || '').toUpperCase() === 'SHURU'
                        || (parseFloat(subscription.plan_price || 0) <= 0
                            && subscription.billing_model !== 'per_order')) {
                        results.invoicesSkipped++;
                        continue;
                    }

                    // A subscription is billed when its paid period ends, not when
                    // the calendar month turns. Without this the monthly cron billed
                    // every active subscription on the 1st, so a yearly subscriber was
                    // charged the full annual amount a month into a year they had
                    // already paid for — and suspended three days later.
                    if (!this.isRenewalDue(subscription, runDate)) {
                        results.invoicesSkipped++;
                        continue;
                    }

                    const invoiceData = await this.calculateInvoice(subscription, runDate);

                    // Idempotency is keyed to the period being billed, so re-running
                    // the job for the same boundary finds the same invoice. (The old
                    // check was keyed to the calendar month, which let a yearly
                    // subscriber be re-invoiced every time the year rolled over.)
                    const invoiceType = recurringInvoiceTypeFor(invoiceData.billingCycle);
                    const existingInvoice = await this.checkExistingInvoice(
                        subscription, invoiceData.billingPeriodStart, invoiceType,
                    );
                    if (existingInvoice) {
                        this.logger.info(`Invoice already exists for this period`, {
                            shopId: subscription.shop_id,
                            invoiceId: existingInvoice.id,
                            invoiceNumber: existingInvoice.invoice_number
                        });
                        results.invoicesSkipped++;
                        continue;
                    }

                    // Skip per-order Partner shops with no billable deliveries this
                    // period — no point issuing a ৳0 invoice (and it would suspend
                    // them via the reconciler for "non-payment").
                    if (subscription.billing_model === 'per_order' && invoiceData.totalAmount <= 0) {
                        results.invoicesSkipped++;
                        continue;
                    }

                    if (!dryRun) {
                        const invoice = await this.createInvoice(subscription, invoiceData, runDate);
                        if (invoice?.__alreadyExisting) {
                            results.invoicesSkipped++;
                            continue;
                        }
                        invoiceData.invoiceId = invoice.id;
                        invoiceData.invoiceNumber = invoice.invoice_number;
                    }

                    results.invoicesGenerated++;
                    results.totalInvoiceAmount += invoiceData.totalAmount;
                    results.invoiceDetails.push(invoiceData);
                    this.metrics.recordsSucceeded++;

                } catch (error) {
                    this.logger.error(`Failed to generate invoice for shop ${subscription.shop_id}`, error);
                    this.metrics.recordsFailed++;
                    this.metrics.errors.push(`Shop ${subscription.shop_id}: ${error.message}`);
                }
            }
        }

        results.subscriptionsProcessed = offset;
        return results;
    }

    /**
     * Whether the subscription's paid period has ended, so a renewal is owed.
     *
     * This is the domain rule the billing cycle actually turns on. `next_billing_date`
     * is maintained on every plan change and on every paid invoice
     * (subscription.service: updatePlan / activateFromPaidInvoice), for both cycles.
     * A subscription with no period recorded at all is billed rather than skipped —
     * failing closed here would silently stop invoicing a real customer.
     */
    isRenewalDue(subscription, runDate) {
        if (this.periodWasJustReset(subscription, runDate)) return true;
        const dueAt = subscription.next_billing_date || subscription.current_period_end;
        if (!dueAt) return true;
        return new Date(dueAt).getTime() <= runDate.getTime();
    }

    periodWasJustReset(subscription, runDate) {
        if (!subscription?.usage_reset_at || !subscription?.current_period_start) return false;
        const currentPeriodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end).getTime()
            : Number.POSITIVE_INFINITY;
        return new Date(subscription.usage_reset_at).getTime()
            < new Date(subscription.current_period_start).getTime()
            && currentPeriodEnd > runDate.getTime();
    }

    /**
     * The invoice already covering this exact period, if one was written.
     *
     * Keyed on the period start rather than the calendar month: the period comes
     * deterministically from the subscription, so re-running the job for the same
     * boundary matches the same row and cannot double-bill.
     */
    async checkExistingInvoice(subscription, billingPeriodStart, invoiceType = null) {
        return Invoice.findOne({
            where: {
                subscription_id: subscription.id,
                billing_period_start: billingPeriodStart,
                ...(invoiceType ? { invoice_type: invoiceType } : {}),
            }
        });
    }

    /**
     * Calculate invoice amounts
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    async calculateInvoice(subscription, runDate) {
        // Previous month's usage (before reset) — also the window per-order
        // Partner deliveries are counted over.
        const startOfMonth = new Date(runDate.getFullYear(), runDate.getMonth() - 1, 1);
        const endOfMonth = new Date(runDate.getFullYear(), runDate.getMonth(), 0, 23, 59, 59);

        // The invoice covers the entitlement that just ended, which for a yearly
        // subscription is a year — not the previous calendar month. Per-order
        // Partner plans keep the monthly window they are actually metered over.
        const hasRecordedPeriod = subscription.current_period_start
            && subscription.current_period_end;
        const periodWasJustReset = this.periodWasJustReset(subscription, runDate);

        const billingPeriodStart = hasRecordedPeriod
            ? (periodWasJustReset ? new Date(subscription.usage_reset_at) : new Date(subscription.current_period_start))
            : startOfMonth;
        const billingPeriodEnd = hasRecordedPeriod
            ? (periodWasJustReset ? new Date(subscription.current_period_start) : new Date(subscription.current_period_end))
            : endOfMonth;

        const invoiceData = {
            shopId: subscription.shop_id,
            shopName: subscription.shop?.name || 'Unknown',
            planName: subscription.plan_name,
            billingCycle: subscription.billing_cycle,
            billingPeriodStart,
            billingPeriodEnd,

            // Base subscription amount (0 for per-order Partner plans)
            baseAmount: parseFloat(subscription.plan_price),

            // Overage billing is retired. Legacy counters are captured for
            // diagnostics only and are never added to a new invoice.
            conversationsUsed: subscription.conversations_used,
            ordersUsed: subscription.orders_used,
            productsUsed: subscription.products_used,
            extraCharges: 0,

            // Partner (per-order) charge — populated below for per_order plans
            deliveredOrders: 0,
            partnerCharge: 0,
            partnerGrossCharge: 0,
            partnerAdjustmentCredit: 0,
            partnerRateBand: null,
            partnerRateBdt: 0,

            // Totals
            subtotal: 0,
            tax: 0,
            totalAmount: 0
        };

        // Partner (per-order) billing: recompute delivered orders at month-end
        // from the immutable delivery stamp. This is race-free and re-runnable.
        if (subscription.billing_model === 'per_order') {
            const { Order } = require('../modules/entities');
            const { calculatePartnerCharge } = require('../modules/subscription/subscription.plans');
            const periodEndExclusive = billingPeriodEnd;
            const countedDeliveredOrders = await Order.count({
                where: {
                    shop_id: subscription.shop_id,
                    order_status: 'delivered',
                    delivered_at: { [Op.gte]: billingPeriodStart, [Op.lt]: periodEndExclusive }
                }
            });
            let deliveredOrders = countedDeliveredOrders;
            if (typeof Order.findAll === 'function') {
                const deliveredRows = await Order.findAll({
                    where: {
                        shop_id: subscription.shop_id,
                        order_status: 'delivered',
                        delivered_at: { [Op.gte]: billingPeriodStart, [Op.lt]: periodEndExclusive }
                    },
                    attributes: ['id', 'metadata']
                });
                deliveredOrders = deliveredRows.filter((order) => {
                    const metadata = order.metadata || {};
                    return !['approved', 'refunded'].includes(metadata.returnStatus);
                }).length;
            }
            invoiceData.deliveredOrders = deliveredOrders;
            invoiceData.partnerGrossCharge = calculatePartnerCharge(deliveredOrders);
            invoiceData.partnerCharge = invoiceData.partnerGrossCharge;
            const rateTier = getPartnerOrderTier(deliveredOrders);
            invoiceData.partnerRateBand = rateTier
                ? `${rateTier.minOrders}-${rateTier.maxOrders === null ? '+' : rateTier.maxOrders}`
                : null;
            invoiceData.partnerRateBdt = rateTier?.rateBdt || 0;

            if (PartnerBillingAdjustment && typeof PartnerBillingAdjustment.findAll === 'function') {
                const adjustments = await PartnerBillingAdjustment.findAll({
                    where: { shop_id: subscription.shop_id, status: 'pending' },
                    order: [['created_at', 'ASC']]
                });
                invoiceData.partnerAdjustmentCredit = adjustments.reduce(
                    (total, adjustment) => total + Math.max(0, Number(adjustment.amount_bdt) || 0),
                    0,
                );
                invoiceData.partnerCharge = Math.max(
                    0,
                    invoiceData.partnerGrossCharge - invoiceData.partnerAdjustmentCredit,
                );
                invoiceData.partnerAdjustments = adjustments;
            }
        }

        // Calculate subtotal
        invoiceData.subtotal = invoiceData.baseAmount + invoiceData.extraCharges + invoiceData.partnerCharge;

        // Pricing is VAT-inclusive / all-in (founder decision): the advertised ৳999
        // plan invoices at exactly ৳999, no VAT line added on top. Kept as a named
        // rate so VAT can be re-enabled centrally if NBR registration requires it.
        const BD_VAT_RATE = 0;
        invoiceData.tax = Math.round(invoiceData.subtotal * BD_VAT_RATE);
        invoiceData.vatRate = BD_VAT_RATE;

        // Calculate total
        invoiceData.totalAmount = invoiceData.subtotal + invoiceData.tax;

        return invoiceData;
    }

    /**
     * Create invoice in database
     * @param {Object} subscription 
     * @param {Object} invoiceData 
     * @param {Date} runDate 
     */
    async createInvoice(subscription, invoiceData, runDate) {
        const invoiceNumber = await this.generateInvoiceNumber(subscription, runDate);
        const values = {
            subscription_id: subscription.id,
            shop_id: subscription.shop_id,
            invoice_number: invoiceNumber,
            invoice_type: recurringInvoiceTypeFor(invoiceData.billingCycle),
            amount: invoiceData.totalAmount,
            base_amount: invoiceData.baseAmount,
            // Partner per-order charge is usage-based; conversation overage is retired.
            extra_usage_amount: invoiceData.extraCharges + invoiceData.partnerCharge,
            billing_period: invoiceData.billingPeriodStart.toISOString().substring(0, 7),
            status: 'pending',
            billing_period_start: invoiceData.billingPeriodStart,
            billing_period_end: invoiceData.billingPeriodEnd,
            // 3-day due threshold (founder spec): once this window lapses unpaid, the
            // failed-payment reconciler suspends the subscription and the AI stops.
            due_date: new Date(runDate.getTime() + 3 * 24 * 60 * 60 * 1000),
            metadata: {
                plan_code: subscription.plan_code,
                planName: invoiceData.planName,
                billingCycle: invoiceData.billingCycle,
                baseAmount: invoiceData.baseAmount,
                extraCharges: invoiceData.extraCharges,
                deliveredOrders: invoiceData.deliveredOrders,
                partnerCharge: invoiceData.partnerCharge,
                gross_partner_charge: invoiceData.partnerGrossCharge,
                adjustment_credit: invoiceData.partnerAdjustmentCredit,
                delivered_orders: invoiceData.deliveredOrders,
                rate_band: invoiceData.partnerRateBand,
                rate_bdt: invoiceData.partnerRateBdt,
                computed_total: invoiceData.partnerCharge,
                conversationsUsed: invoiceData.conversationsUsed,
                ordersUsed: invoiceData.ordersUsed,
                productsUsed: invoiceData.productsUsed,
                subtotal: invoiceData.subtotal,
                tax: invoiceData.tax,
                vatRate: invoiceData.vatRate
            }
        };

        try {
            const invoice = await sequelize.transaction(async (transaction) => {
                const created = await Invoice.create(values, { transaction });
                if (Array.isArray(invoiceData.partnerAdjustments)) {
                    for (const adjustment of invoiceData.partnerAdjustments) {
                        await adjustment.update({
                            status: 'applied',
                            invoice_id: created.id,
                            applied_at: new Date()
                        }, { transaction });
                    }
                }
                return created;
            });
            return invoice;
        } catch (error) {
            if (error?.name === 'SequelizeUniqueConstraintError') {
                const existing = await this.checkExistingInvoice(
                    subscription,
                    invoiceData.billingPeriodStart,
                    recurringInvoiceTypeFor(invoiceData.billingCycle),
                );
                if (existing) {
                    existing.__alreadyExisting = true;
                    return existing;
                }
            }
            throw error;
        }

        this.logger.info(`Generated invoice for shop ${subscription.shop_id}`, {
            shopId: subscription.shop_id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_number,
            amount: invoice.amount
        });

        return invoice;
    }

    /**
     * Generate a collision-resistant invoice number.
     *
     * Format: INV-YYYYMM-XXXXXX (6 random hex chars = 1-in-16M collision chance per month)
     * The invoice_number column has a UNIQUE constraint as the final safety net.
     *
     * Previous implementation used COUNT(*)+1 which is a non-atomic read-modify-write
     * and produces duplicate numbers under concurrent execution.
     */
    async generateInvoiceNumber(subscription, runDate) {
        const yearMonth = runDate.toISOString().substring(0, 7).replace('-', ''); // 202602
        const uniqueSuffix = crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. A3F9C2
        return `INV-${yearMonth}-${uniqueSuffix}`;
    }
}

module.exports = InvoiceGenerator;
