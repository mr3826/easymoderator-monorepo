const subscriptionService = require('./subscription.service');
const { validationResult } = require('express-validator');
const { AppError } = require('../../utils/AppError');
const { Shop } = require('../entities');

/**
 * Get subscription details
 */
const getSubscription = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const data = await subscriptionService.getSubscription(shopId, req.user.userId);

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update subscription plan
 */
const updatePlan = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const subscription = await subscriptionService.updatePlan(
            shopId,
            req.user.userId,
            req.body
        );

        res.status(200).json({
            success: true,
            message: 'Subscription plan updated successfully',
            data: subscription
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Request conversation pack
 */
const requestConversationPack = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { amount, price } = req.body;

        const result = await subscriptionService.requestConversationPack(
            shopId,
            req.user.userId,
            amount,
            price
        );

        res.status(200).json({
            success: true,
            message: result.message,
            data: result.invoice
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get invoices
 */
const getInvoices = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const invoices = await subscriptionService.getInvoices(shopId, req.user.userId);

        res.status(200).json({
            success: true,
            data: invoices
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get invoice by ID
 */
const getInvoiceById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { invoiceId } = req.params;

        const invoice = await subscriptionService.getInvoiceById(
            invoiceId,
            shopId,
            req.user.userId
        );

        res.status(200).json({
            success: true,
            data: invoice
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Check rate limit
 */
const checkRateLimit = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { customer_id } = req.body;
        if (!customer_id) {
            throw new AppError('customer_id is required', 400);
        }

        const result = await subscriptionService.checkRateLimit(shopId, req.user.userId, customer_id);

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Increment rate limit counter
 */
const incrementRateLimit = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { customer_id } = req.body;
        if (!customer_id) {
            throw new AppError('customer_id is required', 400);
        }

        const result = await subscriptionService.incrementRateLimit(shopId, req.user.userId, customer_id);

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

/**
 * Initiate payment for a pending subscription invoice
 */
const payInvoice = async (req, res, next) => {
    try {
        const { shopId, userId } = req.user;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);

        const { invoiceId } = req.params;
        const { gateway } = req.body;

        if (!gateway) throw new AppError('gateway is required (aamarpay or sslcommerz)', 400);

        const paymentService = require('../payment/payment.service');
        const result = await paymentService.initiateSubscriptionInvoicePayment(
            invoiceId, shopId, userId, gateway
        );

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * Return an HTML invoice page suitable for browser printing / Save-as-PDF.
 * No external PDF library required — the browser handles rendering.
 */
const getInvoicePdf = async (req, res, next) => {
    try {
        const { shopId, userId } = req.user;
        if (!shopId) throw new AppError('No shop selected.', 400);

        const { invoiceId } = req.params;
        const invoice = await subscriptionService.getInvoiceById(invoiceId, shopId, userId);
        const shop = await Shop.findOne({ where: { id: shopId }, attributes: ['name', 'email'] });

        const invoiceDate = new Date(invoice.created_at).toLocaleDateString('en-BD', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
        const dueDate = invoice.due_date
            ? new Date(invoice.due_date).toLocaleDateString('en-BD', { day: 'numeric', month: 'long', year: 'numeric' })
            : '—';
        const paidDate = invoice.paid_at
            ? new Date(invoice.paid_at).toLocaleDateString('en-BD', { day: 'numeric', month: 'long', year: 'numeric' })
            : null;

        const statusColor = invoice.status === 'paid' ? '#15803d' : invoice.status === 'pending' ? '#b45309' : '#dc2626';

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; background: #fff; padding: 40px; max-width: 720px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .brand { font-size: 22px; font-weight: 700; color: #2563eb; }
    .brand span { font-size: 12px; display: block; color: #6b7280; font-weight: 400; margin-top: 2px; }
    .invoice-meta { text-align: right; }
    .invoice-meta h1 { font-size: 28px; font-weight: 800; color: #111827; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: white; background: ${statusColor}; margin-top: 6px; text-transform: uppercase; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
    .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
    .value { font-size: 14px; color: #111827; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 8px 12px; border-bottom: 2px solid #e5e7eb; }
    td { padding: 12px; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
    .amount-row td { font-weight: 600; }
    .total-row { background: #f9fafb; }
    .total-row td { font-size: 16px; font-weight: 700; padding: 16px 12px; }
    .footer { font-size: 12px; color: #9ca3af; margin-top: 40px; text-align: center; }
    @media print { body { padding: 20px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">Easy Moderator<span>AI Commerce Assistant</span></div>
    <div class="invoice-meta">
      <h1>INVOICE</h1>
      <div style="font-size:14px;color:#6b7280;margin-top:4px">${invoice.invoice_number}</div>
      <div class="status-badge">${invoice.status}</div>
    </div>
  </div>

  <div class="grid">
    <div>
      <div class="label">Billed To</div>
      <div class="value" style="font-weight:600">${shop?.name || 'Shop'}</div>
      ${shop?.email ? `<div class="value" style="color:#6b7280">${shop.email}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="label">Invoice Date</div>
      <div class="value">${invoiceDate}</div>
      <div class="label" style="margin-top:12px">Due Date</div>
      <div class="value">${dueDate}</div>
      ${paidDate ? `<div class="label" style="margin-top:12px">Paid On</div><div class="value" style="color:#15803d;font-weight:600">${paidDate}</div>` : ''}
    </div>
  </div>

  <hr class="divider">

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Period</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr class="amount-row">
        <td>${invoice.invoice_type || 'Subscription'}</td>
        <td style="color:#6b7280">${invoice.billing_period || '—'}</td>
        <td style="text-align:right">৳${parseFloat(invoice.base_amount || invoice.amount).toLocaleString()}</td>
      </tr>
      ${parseFloat(invoice.extra_usage_amount || 0) > 0 ? `
      <tr><td>Extra Usage</td><td></td><td style="text-align:right">৳${parseFloat(invoice.extra_usage_amount).toLocaleString()}</td></tr>` : ''}
      ${parseFloat(invoice.addon_amount || 0) > 0 ? `
      <tr><td>Add-ons</td><td></td><td style="text-align:right">৳${parseFloat(invoice.addon_amount).toLocaleString()}</td></tr>` : ''}
      <tr class="total-row">
        <td colspan="2">Total Due</td>
        <td style="text-align:right">৳${parseFloat(invoice.amount).toLocaleString()}</td>
      </tr>
    </tbody>
  </table>

  ${invoice.notes ? `<div style="font-size:13px;color:#6b7280;margin-bottom:24px"><strong>Notes:</strong> ${invoice.notes}</div>` : ''}

  <hr class="divider">
  <div class="footer">Easy Moderator &bull; easymod.io &bull; This is a computer-generated invoice.</div>

  <script>
    // Auto-open print dialog when opened in a new tab
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="invoice-${invoice.invoice_number}.html"`);
        res.send(html);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getSubscription,
    updatePlan,
    requestConversationPack,
    getInvoices,
    getInvoiceById,
    checkRateLimit,
    incrementRateLimit,
    payInvoice,
    getInvoicePdf
};
