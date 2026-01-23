const BaseJob = require('./base-job');
const { Subscription, Invoice, Shop } = require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { Op } = require('sequelize');

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

        // Get all active subscriptions
        const subscriptions = await Subscription.findAll({
            where: {
                status: 'active'
            },
            include: [{
                model: Shop,
                as: 'shop',
                required: true
            }]
        });

        this.metrics.recordsProcessed = subscriptions.length;

        for (const subscription of subscriptions) {
            try {
                // Check if invoice already exists for this period (idempotency)
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

                // Calculate invoice amounts
                const invoiceData = await this.calculateInvoice(subscription, runDate);

                // Generate invoice (if not dry-run)
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

        results.subscriptionsProcessed = subscriptions.length;

        return results;
    }

    /**
     * Check if invoice already exists for this period
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
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
        const endOfMonth = new Date(runDate.getFullYear(), runDate.getMonth(), 0);

        const invoiceData = {
            shopId: subscription.shop_id,
            shopName: subscription.shop?.name || 'Unknown',
            planName: subscription.plan_name,
            billingCycle: subscription.billing_cycle,
            billingPeriodStart: startOfMonth,
            billingPeriodEnd: endOfMonth,
            
            // Base subscription amount
            baseAmount: parseFloat(subscription.plan_price),
            
            // Usage charges
            conversationsUsed: subscription.conversations_used,
            ordersUsed: subscription.orders_used,
            productsUsed: subscription.products_used,
            extraCharges: parseFloat(subscription.extra_charges || 0),
            
            // Totals
            subtotal: 0,
            tax: 0,
            totalAmount: 0
        };

        // Calculate subtotal
        invoiceData.subtotal = invoiceData.baseAmount + invoiceData.extraCharges;
        
        // Calculate tax (if applicable)
        // TODO: Add tax calculation based on shop location
        invoiceData.tax = 0;
        
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
            amount: invoiceData.totalAmount,
            status: 'pending',
            billing_period_start: invoiceData.billingPeriodStart,
            billing_period_end: invoiceData.billingPeriodEnd,
            due_date: new Date(runDate.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            metadata: {
                planName: invoiceData.planName,
                billingCycle: invoiceData.billingCycle,
                baseAmount: invoiceData.baseAmount,
                extraCharges: invoiceData.extraCharges,
                conversationsUsed: invoiceData.conversationsUsed,
                ordersUsed: invoiceData.ordersUsed,
                productsUsed: invoiceData.productsUsed,
                subtotal: invoiceData.subtotal,
                tax: invoiceData.tax
            }
        });

        this.logger.info(`Generated invoice for shop ${subscription.shop_id}`, {
            shopId: subscription.shop_id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_number,
            amount: invoice.amount
        });

        return invoice;
    }

    /**
     * Generate invoice number (e.g., INV-2026-02-001)
     * @param {Object} subscription 
     * @param {Date} runDate 
     */
    async generateInvoiceNumber(subscription, runDate) {
        const yearMonth = runDate.toISOString().substring(0, 7).replace('-', ''); // 202602
        
        // Get count of invoices this month
        const startOfMonth = new Date(runDate.getFullYear(), runDate.getMonth(), 1);
        const endOfMonth = new Date(runDate.getFullYear(), runDate.getMonth() + 1, 0);
        
        const invoiceCount = await Invoice.count({
            where: {
                created_at: {
                    [Op.gte]: startOfMonth,
                    [Op.lte]: endOfMonth
                }
            }
        });

        const sequenceNumber = (invoiceCount + 1).toString().padStart(3, '0');
        
        return `INV-${yearMonth}-${sequenceNumber}`;
    }
}

module.exports = InvoiceGenerator;
