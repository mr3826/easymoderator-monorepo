'use strict';

/**
 * Invoice Payment Controller
 *
 * Endpoints:
 *   POST /subscription/invoices/:invoiceId/pay  — start bKash checkout for an invoice
 *   POST /subscription/renew                    — ensure + pay the monthly renewal invoice
 *   POST /subscription/invoices/pay/complete    — verify bKash payment and settle invoice
 */

const invoicePaymentService = require('./invoice-payment.service');
const { AppError } = require('../../utils/AppError');

const payInvoice = async (req, res, next) => {
    try {
        const { shopId, phone, name } = req.user;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);

        const { invoiceId } = req.params;
        const { callback_url, phone: bodyPhone, name: bodyName } = req.body;
        if (!callback_url) throw new AppError('callback_url is required', 400);

        const result = await invoicePaymentService.initiateInvoicePayment(shopId, invoiceId, {
            phone: bodyPhone || phone,
            name: bodyName || name,
            callbackUrl: callback_url
        });

        res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
};

const renew = async (req, res, next) => {
    try {
        const { shopId, userId, phone, name } = req.user;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);

        const { callback_url, phone: bodyPhone, name: bodyName } = req.body;
        if (!callback_url) throw new AppError('callback_url is required', 400);

        const result = await invoicePaymentService.initiateRenewalPayment(shopId, userId, {
            phone: bodyPhone || phone,
            name: bodyName || name,
            callbackUrl: callback_url
        });

        res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
};

const completePayment = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);

        const { invoice_id, payment_id } = req.body;
        if (!invoice_id || !payment_id) throw new AppError('invoice_id and payment_id are required', 400);

        const result = await invoicePaymentService.completeInvoicePayment(shopId, invoice_id, payment_id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

module.exports = { payInvoice, renew, completePayment };
