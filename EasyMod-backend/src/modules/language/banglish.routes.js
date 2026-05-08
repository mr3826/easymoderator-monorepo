const express = require('express');
const { body, validationResult } = require('express-validator');
const { detectLanguage } = require('./language-switcher.service');

const router = express.Router();

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
};

/**
 * POST /api/language/detect
 * Detect the language of the supplied text.
 * Body: { text }
 * Returns: { language: 'bn' | 'en' | 'banglish', confidence: 0-1 }
 */
router.post(
    '/detect',
    [
        body('text').trim().notEmpty().withMessage('text is required').isLength({ max: 5000 })
    ],
    validate,
    (req, res) => {
        const result = detectLanguage(req.body.text);
        res.status(200).json({ success: true, data: result });
    }
);

module.exports = router;
