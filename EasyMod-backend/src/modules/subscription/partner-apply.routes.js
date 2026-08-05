'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const partnerService = require('./partner.service');

const router = express.Router();
const publicPartnerWriteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
});

const validate = [
    body('businessName').trim().notEmpty().withMessage('businessName is required'),
    body('phone')
        .matches(/^01[3-9]\d{8}$/)
        .withMessage('Invalid Bangladesh phone number'),
    body('pageLink').trim().notEmpty().withMessage('pageLink is required'),
];

router.post('/apply', publicPartnerWriteLimiter, validate, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ success: false, errors: errors.array() });
    }

    const { businessName, phone, pageLink } = req.body;
    // shopId is optional — present only when an authenticated in-app shop applies.
    const shopId = req.user?.shopId || null;

    try {
        const application = await partnerService.applyForPartner({ businessName, phone, pageLink, shopId });
        return res.status(200).json({ success: true, application_id: application.id });
    } catch (err) {
        // Never leak internals to the public form; the email is best-effort and
        // persistence failure is the only real error path.
        return res.status(500).json({ success: false, message: 'Could not submit application' });
    }
});

module.exports = router;
