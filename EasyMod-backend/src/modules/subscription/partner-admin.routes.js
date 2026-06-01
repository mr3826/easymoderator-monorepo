'use strict';

/**
 * Partner Admin routes — list + approve Partner applications.
 *
 * Guarded by a shared-secret header (x-admin-key === process.env.ADMIN_API_KEY)
 * rather than the user session, because partner approval is an internal ops
 * action and there is no first-class admin role yet. If ADMIN_API_KEY is not
 * configured the endpoints return 503 (disabled) so they can never be hit
 * anonymously. The scripts/approve-partner.js CLI is the primary tool; this
 * endpoint is a convenience that uses the same partner.service logic.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const partnerService = require('./partner.service');

const router = express.Router();

const requireAdminKey = (req, res, next) => {
    const configured = process.env.ADMIN_API_KEY;
    if (!configured) {
        return res.status(503).json({ success: false, message: 'Admin API disabled (ADMIN_API_KEY not set)' });
    }
    if (req.get('x-admin-key') !== configured) {
        return res.status(401).json({ success: false, message: 'Invalid admin key' });
    }
    return next();
};

router.use(requireAdminKey);

// List applications (optional ?status=pending|approved|rejected)
router.get('/applications', async (req, res) => {
    try {
        const apps = await partnerService.listApplications({ status: req.query.status });
        return res.json({ success: true, data: apps });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Approve an application → flips the bound shop to the PARTNER plan.
router.post(
    '/applications/:id/approve',
    [body('shopId').optional().isUUID().withMessage('shopId must be a UUID')],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ success: false, errors: errors.array() });
        }
        try {
            const result = await partnerService.approvePartner(req.params.id, {
                reviewerId: req.get('x-admin-key') ? 'admin-api' : 'admin',
                shopId: req.body.shopId || null
            });
            return res.json({
                success: true,
                application: result.application,
                subscription: { shop_id: result.subscription.shop_id, plan_code: result.subscription.plan_code }
            });
        } catch (err) {
            return res.status(err.statusCode || 500).json({ success: false, message: err.message });
        }
    }
);

module.exports = router;
