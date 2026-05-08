'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const emailService = require('../../utils/email.service');

const router = express.Router();

const validate = [
    body('businessName').trim().notEmpty().withMessage('businessName is required'),
    body('phone')
        .matches(/^01[3-9]\d{8}$/)
        .withMessage('Invalid Bangladesh phone number'),
    body('pageLink').trim().notEmpty().withMessage('pageLink is required'),
];

router.post('/apply', validate, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ success: false, errors: errors.array() });
    }

    const { businessName, phone, pageLink } = req.body;
    const adminEmail = process.env.ADMIN_EMAIL || 'hello@hexabyte.co';

    await emailService.sendEmail({
        to: adminEmail,
        subject: `[Easy Moderator] New Partner Application — ${businessName}`,
        text: `New Partner plan application received.\n\nBusiness: ${businessName}\nPhone: ${phone}\nFacebook Page: ${pageLink}\n`,
        html: `<h2>New Partner Plan Application</h2>
               <p><strong>Business:</strong> ${businessName}</p>
               <p><strong>Phone:</strong> ${phone}</p>
               <p><strong>Facebook Page:</strong> <a href="${pageLink}">${pageLink}</a></p>`,
    }).catch(() => {});

    return res.status(200).json({ success: true });
});

module.exports = router;
