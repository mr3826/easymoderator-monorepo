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
        .notEmpty()
        .withMessage('Query is required'),
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