const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const ReconciliationService = require('./reconciliation.service');
const { AppError } = require('../../utils/AppError');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/reconciliation/collections
 * List courier COD collection records for the authenticated shop.
 */
router.get('/collections', async (req, res, next) => {
    try {
        const { page, limit, provider } = req.query;
        const result = await ReconciliationService.listCollections(req.user.shopId, {
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 20,
            provider
        });
        res.json(result);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/reconciliation/collections/pull
 * Manually trigger a Steadfast payment pull for the shop.
 */
router.post('/collections/pull', async (req, res, next) => {
    try {
        const result = await ReconciliationService.pullSteadfastPayments(req.user.shopId);
        res.json({ success: true, ...result });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/reconciliation/disputes
 * List disputes for the authenticated shop.
 */
router.get('/disputes', async (req, res, next) => {
    try {
        const { page, limit, status } = req.query;
        const result = await ReconciliationService.listDisputes(req.user.shopId, {
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 20,
            status
        });
        res.json(result);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/reconciliation/disputes
 * Manually create a dispute.
 */
router.post('/disputes', async (req, res, next) => {
    try {
        const { provider, paymentReference, claimedAmount, expectedAmount, notes } = req.body;
        if (!provider || !paymentReference || claimedAmount == null || expectedAmount == null) {
            return next(new AppError('provider, paymentReference, claimedAmount, and expectedAmount are required', 400));
        }
        const dispute = await ReconciliationService.createDispute(req.user.shopId, {
            provider, paymentReference,
            claimedAmount: parseFloat(claimedAmount),
            expectedAmount: parseFloat(expectedAmount),
            notes
        });
        res.status(201).json(dispute);
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /api/reconciliation/disputes/:id
 * Update dispute status (under_review, resolved, rejected).
 */
router.patch('/disputes/:id', async (req, res, next) => {
    try {
        const { status, notes } = req.body;
        const allowed = ['under_review', 'resolved', 'rejected'];
        if (!status || !allowed.includes(status)) {
            return next(new AppError(`status must be one of: ${allowed.join(', ')}`, 400));
        }
        const dispute = await ReconciliationService.updateDisputeStatus(
            req.params.id, req.user.shopId, { status, notes, resolvedBy: req.user?.userId }
        );
        res.json(dispute);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
