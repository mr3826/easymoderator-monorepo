const express = require('express');
const subscriptionController = require('./subscription.controller');
const topupController = require('./topup.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const {
    updatePlanValidator,
    requestConversationPackValidator
} = require('./subscription.validator');
const { PRICING_TIERS } = require('./subscription.plans');

const router = express.Router();

// All subscription routes require authentication
router.use(authenticate);

// GET /subscription - Get subscription details
router.get('/', subscriptionController.getSubscription);

// GET /subscription/plans — static plan catalog (Free, Package 1 750 BDT, Package 2 1950 BDT, Partner)
router.get('/plans', (req, res) => {
    const plans = [
        {
            id: 'FREE',
            code: 'FREE',
            name: 'Free',
            price_bdt_monthly: 0,
            price_bdt_yearly: 0,
            conversations_limit: 50,
            key_feature: 'Try EasyModerator — 50 conversations/month',
            billing_model: 'flat_monthly'
        },
        ...Object.values(PRICING_TIERS).map(t => ({
            id: t.code,
            code: t.code,
            name: t.name,
            price_bdt_monthly: t.priceBdtMonthly,
            price_bdt_yearly: t.priceBdtYearly,
            conversations_limit: t.conversationsLimit,
            orders_limit: t.ordersLimit,
            key_feature: t.keyFeature,
            billing_model: t.billingModel
        }))
    ];
    res.json({ success: true, data: plans });
});

// POST /subscription/cancel — cancel current subscription (schedule cancellation at period end)
router.post('/cancel', async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) throw Object.assign(new Error('No shop selected.'), { statusCode: 400 });
        const { Subscription } = require('../entities');
        const sub = await Subscription.findOne({ where: { shop_id: shopId } });
        if (!sub) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No subscription found.' } });
        await sub.update({
            cancel_at_period_end: true,
            cancellation_reason: req.body.reason || null,
            cancelled_at: new Date()
        });
        res.json({ success: true, data: sub });
    } catch (err) {
        next(err);
    }
});

// POST /subscription/reactivate — undo pending cancellation
router.post('/reactivate', async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) throw Object.assign(new Error('No shop selected.'), { statusCode: 400 });
        const { Subscription } = require('../entities');
        const sub = await Subscription.findOne({ where: { shop_id: shopId } });
        if (!sub) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No subscription found.' } });
        await sub.update({
            cancel_at_period_end: false,
            cancellation_reason: null,
            cancelled_at: null
        });
        res.json({ success: true, data: sub });
    } catch (err) {
        next(err);
    }
});

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
