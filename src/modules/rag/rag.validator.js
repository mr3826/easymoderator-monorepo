const { body } = require('express-validator');

/**
 * Validator for RAG data ingestion
 */
const ingestDataValidator = [
    body('data')
        .notEmpty()
        .withMessage('Data is required'),
    body('metadata')
        .optional()
        .isObject()
        .withMessage('Metadata must be an object')
];

/**
 * Validator for RAG queries
 */
const queryDataValidator = [
    body('query')
        .trim()
        .notEmpty().withMessage('Query is required')
        // Length cap: prevents context-window exhaustion and prompt injection via huge payloads
        .isLength({ max: 2000 }).withMessage('Query must be 2000 characters or fewer')
        // Strip ASCII control characters (null bytes, bell chars, etc.) that can
        // confuse LLM tokenizers or bypass injection filters
        .customSanitizer(v => typeof v === 'string'
            ? v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            : v),
    body('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    body('filters')
        .optional()
        .isObject()
        .withMessage('Filters must be an object')
];

module.exports = {
    ingestDataValidator,
    queryDataValidator
};