const BaseJob = require('./base-job');
const { Subscription, Invoice, Shop } = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { Op } = require('sequelize');
const crypto = require('crypto');

/**
 * Invoice Generator Job
 * 
 * Generates monthly invoices for all active subscriptions.
 * Runs on the 1st day of each month at 01:00 UTC (after usage reset).
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
     * Generate execution ID based on month
     * @param {Date} runDate 
     */
    generateExecutionId(runDate) {
        const yearMonth = runDate.toISOString().substring(0, 7); // YYYY-MM
        return `${this.jobName}-${yearMonth}`;
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
                    // FREE tier has no recurring charge — never generate an invoice for it.
                    if (String(subscription.plan_code || '').toUpperCase() === 'FREE') {
                        results.invoicesSkipped++;
                        continue;
                    }

                    // Yearly subscriptions: generate one invoice per year, not every month
                    if (subscription.billing_cycle === 'yearly') {
                        const yearlyInvoiceExists = await this.checkExistingYearlyInvoice(subscription, runDate);
                        if (yearlyInvoiceExists) {
                            results.invoicesSkipped++;
                            continue;
                        }
                    }

                    const existingInvoice = await this.checkExistingInvoice(subscription, runDate);
                    if (existingInvoice && !dryRun) {
                        this.logger.info(`Invoice already exists for this period`, {
                            shopId: subscription.shop_id,
                            invoiceId: existingInvoice.id,
                            invoiceNumber: existingInvoice.invoice_number
                        });
                        results.invoicesSkipped++;
                        continue;
                    }

                    const invoiceData = await this.calculateInvoice(subscription, runDate);

                    // Skip per-order Partner shops with no billable deliveries this
                    // period — no point issuing a ৳0 invoice (and it would suspend
                    // them via the reconciler for "non-payment").
                    if (subscription.billing_model === 'per_order' && invoiceData.totalAmount <= 0) {
                        results.invoicesSkipped++;
                        continue;
                    }

                    if (!dryRun) {
                        const invoice = await this.createInvoice(subscription, invoiceData, runDate);
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
     * Check if invoice already exists for this period
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    /**
     * Check if a yearly invoice already exists for the current calendar year.
     * Prevents 12 monthly invoices being generated for yearly subscribers.
     */
    async checkExistingYearlyInvoice(subscription, runDate) {
        const startOfYear = new Date(runDate.getFullYear(), 0, 1);
        const endOfYear = new Date(runDate.getFullYear(), 11, 31, 23, 59, 59);

        return Invoice.findOne({
            where: {
                subscription_id: subscription.id,
                billing_period_start: { [Op.gte]: startOfYear },
                billing_period_end: { [Op.lte]: endOfYear }
            }
        });
    }

    async checkExistingInvoice(subscription, runDate) {
        const startOfMonth = new Date(runDate.getFullYear(), runDate.getMonth(), 1);
        const endOfMonth = new Date(runDate.getFullYear(), runDate.getMonth() + 1, 0);

        const existingInvoice = await Invoice.findOne({
            where: {
                subscription_id: subscription.id,
                billing_period_start: {
                    [Op.gte]: startOfMonth
                },
                billing_period_end: {
                    [Op.lte]: endOfMonth
                }
            }
        });

        return existingInvoice;
    }

    /**
     * Calculate invoice amounts
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    async calculateInvoice(subscription, runDate) {
        // Previous month's usage (before reset)
        const startOfMonth = new Date(runDate.getFullYear(), runDate.getMonth() - 1, 1);
        const endOfMonth = new Date(runDate.getFullYear(), runDate.getMonth(), 0, 23, 59, 59);

        const invoiceData = {
            shopId: subscription.shop_id,
            shopName: subscription.shop?.name || 'Unknown',
            planName: subscription.plan_name,
            billingCycle: subscription.billing_cycle,
            billingPeriodStart: startOfMonth,
            billingPeriodEnd: endOfMonth,

            // Base subscription amount (0 for per-order Partner plans)
            baseAmount: parseFloat(subscription.plan_price),

            // Usage charges (entity column is `extra_charge`, singular)
            conversationsUsed: subscription.conversations_used,
            ordersUsed: subscription.orders_used,
            productsUsed: subscription.products_used,
            extraCharges: parseFloat(subscription.extra_charge || 0),

            // Partner (per-order) charge — populated below for per_order plans
            deliveredOrders: 0,
            partnerCharge: 0,

            // Totals
            subtotal: 0,
            tax: 0,
            totalAmount: 0
        };

        // Partner (per-order) billing: charge delivered orders in the billing
        // period at the tiered PARTNER_ORDER_TIERS rates. Computed from the Order
        // table (not a per-order accrual counter) so it is race-free and
        // re-runnable. Delivery time is approximated by the order's last update.
        if (subscription.billing_model === 'per_order') {
            const { Order } = require('../modules/entities');
            const { calculatePartnerCharge } = require('../modules/subscription/subscription.plans');
            const deliveredOrders = await Order.count({
                where: {
                    shop_id: subscription.shop_id,
                    order_status: 'delivered',
                    updated_at: { [Op.gte]: startOfMonth, [Op.lte]: endOfMonth }
                }
            });
            invoiceData.deliveredOrders = deliveredOrders;
            invoiceData.partnerCharge = calculatePartnerCharge(deliveredOrders);
        }

        // Calculate subtotal
        invoiceData.subtotal = invoiceData.baseAmount + invoiceData.extraCharges + invoiceData.partnerCharge;

        // Bangladesh VAT on digital services: 15% (NBR regulation)
        const BD_VAT_RATE = 0.15;
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
        // Generate invoice number
        const invoiceNumber = await this.generateInvoiceNumber(subscription, runDate);

        const invoice = await Invoice.create({
            subscription_id: subscription.id,
            shop_id: subscription.shop_id,
            invoice_number: invoiceNumber,
            invoice_type: invoiceData.billingCycle === 'per_order' ? 'partner_per_order' : 'monthly_subscription',
            amount: invoiceData.totalAmount,
            base_amount: invoiceData.baseAmount,
            // Partner per-order charge + any conversation extras are usage-based.
            extra_usage_amount: invoiceData.extraCharges + invoiceData.partnerCharge,
            billing_period: invoiceData.billingPeriodStart.toISOString().substring(0, 7),
            status: 'pending',
            billing_period_start: invoiceData.billingPeriodStart,
            billing_period_end: invoiceData.billingPeriodEnd,
            due_date: new Date(runDate.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            metadata: {
                planName: invoiceData.planName,
                billingCycle: invoiceData.billingCycle,
                baseAmount: invoiceData.baseAmount,
                extraCharges: invoiceData.extraCharges,
                deliveredOrders: invoiceData.deliveredOrders,
                partnerCharge: invoiceData.partnerCharge,
                conversationsUsed: invoiceData.conversationsUsed,
                ordersUsed: invoiceData.ordersUsed,
                productsUsed: invoiceData.productsUsed,
                subtotal: invoiceData.subtotal,
                tax: invoiceData.tax,
                vatRate: invoiceData.vatRate
            }
        });

        this.logger.info(`Generated invoice for shop ${subscription.shop_id}`, {
            shopId: subscription.shop_id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_number,
            amount: invoice.amount
        });

        // Reset overage counters — they've been captured in this invoice.
        // The monthly usage reset does NOT reset these (it only resets *_used counters)
        // so they accumulate accurately until invoiced, then clear here.
        // (Entity column is `extra_charge`, singular — the previous `extra_charges`
        // key was a no-op write that never cleared the accrued amount.)
        await subscription.update({
            extra_charge: 0,
            extra_conversations: 0
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
