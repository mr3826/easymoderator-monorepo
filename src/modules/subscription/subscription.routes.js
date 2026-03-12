const express = require('express');
const subscriptionController = require('./subscription.controller');
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

module.exports = router;
