const express = require('express');
const { body, validationResult } = require('express-validator');
const { transliterate, learn } = require('./banglish.controller');

const router = express.Router();

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
};

/**
 * POST /api/language/banglish/transliterate
 * Convert Banglish (Latin) text to Bangla Unicode.
 */
router.post(
    '/banglish/transliterate',
    [
        body('text').trim().notEmpty().withMessage('text is required').isLength({ max: 2000 }),
        body('use_llm').optional().isBoolean(),
        body('min_confidence').optional().isFloat({ min: 0, max: 1 })
    ],
    validate,
    transliterate
);

/**
 * POST /api/language/banglish/learn
 * Add or update a Banglish → Bangla mapping (feedback loop).
 */
router.post(
    '/banglish/learn',
    [
        body('banglish').trim().notEmpty().withMessage('banglish is required').isLength({ max: 255 }),
        body('bangla').trim().notEmpty().withMessage('bangla is required').isLength({ max: 255 }),
        body('confidence').optional().isInt({ min: 0, max: 100 })
    ],
    validate,
    learn
);

module.exports = router;
