const express = require('express');
const subscriptionController = require('./subscription.controller');
const topupController = require('./topup.controller');
const invoicePaymentController = require('./invoice-payment.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const {
    updatePlanValidator,
    requestConversationPackValidator
} = require('./subscription.validator');

const router = express.Router();

// All subscription routes require authentication
router.use(authenticate);

// GET /subscription - Get subscription details
router.get('/', subscriptionController.getSubscription);

// Rate limit endpoints
router.post('/rate-limit/check', subscriptionController.checkRateLimit);
router.post('/rate-limit/increment', subscriptionController.incrementRateLimit);

// PUT /subscription/plan - Update subscription plan
router.put('/plan', updatePlanValidator, subscriptionController.updatePlan);

// POST /subscription/conversation-pack - Request conversation pack
router.post('/conversation-pack', requestConversationPackValidator, subscriptionController.requestConversationPack);

// GET /subscription/invoices - Get all invoices
router.get('/invoices', subscriptionController.getInvoices);

// GET /subscription/invoices/:invoiceId - Get invoice by ID
router.get('/invoices/:invoiceId', subscriptionController.getInvoiceById);

// GET /subscription/invoices/:invoiceId/pdf - Printable HTML invoice
router.get('/invoices/:invoiceId/pdf', subscriptionController.getInvoicePdf);

// ── Invoice payment (bKash) ──────────────────────────────────────────────────
// POST /subscription/renew                    — ensure + start payment of monthly renewal
router.post('/renew', invoicePaymentController.renew);
// POST /subscription/invoices/pay/complete    — verify bKash payment & settle invoice
router.post('/invoices/pay/complete', invoicePaymentController.completePayment);
// POST /subscription/invoices/:invoiceId/pay  — start bKash checkout for a specific invoice
router.post('/invoices/:invoiceId/pay', invoicePaymentController.payInvoice);

// ── Conversation Top-Up ──────────────────────────────────────────────────────
// GET  /subscription/topup/packs    — list packs
router.get('/topup/packs', topupController.getPacks);
// POST /subscription/topup/initiate — start BKash payment
router.post('/topup/initiate', topupController.initiateTopup);
// POST /subscription/topup/complete — verify & credit conversations
router.post('/topup/complete', topupController.completeTopup);
// GET  /subscription/topup/history  — paginated purchase history
router.get('/topup/history', topupController.getHistory);

module.exports = router;
