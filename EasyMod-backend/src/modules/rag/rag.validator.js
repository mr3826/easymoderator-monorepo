const Joi = require('joi');

/**
 * Validator for RAG data ingestion
 */
const ingestDataValidator = Joi.object({
    data: Joi.string()
        .max(50000)
        .required()
        .custom((value, helpers) => {
            // Strip prompt injection patterns: script tags, HTML, template syntax
            const cleaned = value
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<[^>]+>/g, '')
                .replace(/\{\{[^}]*\}\}/g, '')
                .replace(/\$\{[^}]*\}/g, '');
            return cleaned;
        })
        .messages({
            'string.base': 'Data must be a string',
            'string.max': 'Data must be 50,000 characters or fewer',
            'any.required': 'Data is required'
        }),
    content_type: Joi.string()
        .valid('text', 'html', 'markdown', 'json', 'pdf')
        .optional()
        .messages({
            'any.only': 'content_type must be one of: text, html, markdown, json, pdf'
        }),
    collection_id: Joi.string()
        .uuid()
        .optional()
        .messages({
            'string.guid': 'collection_id must be a valid UUID'
        }),
    metadata: Joi.object()
        .optional()
        .messages({
            'object.base': 'Metadata must be an object'
        })
});

/**
 * Validator for RAG queries
 */
const queryDataValidator = Joi.object({
    query: Joi.string()
        .max(2000)
        .required()
        // Strip ASCII control characters (null bytes, bell chars, etc.) that can
        // confuse LLM tokenizers or bypass injection filters
        .custom((value, helpers) => {
            const cleaned = value
                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')   // control chars
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // <script> blocks
                .replace(/<[^>]+>/g, '')          // remaining HTML tags
                .replace(/\{\{[^}]*\}\}/g, '')    // {{ template syntax }}
                .replace(/\$\{[^}]*\}/g, '')      // ${template literals}
                .trim();
            if (!cleaned) {
                return helpers.error('string.empty');
            }
            return cleaned;
        })
        .messages({
            'string.base': 'Query must be a string',
            'string.max': 'Query must be 2000 characters or fewer',
            'any.required': 'Query is required',
            'string.empty': 'Query is required'
        }),
    limit: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .optional()
        .messages({
            'number.base': 'Limit must be between 1 and 100',
            'number.min': 'Limit must be between 1 and 100',
            'number.max': 'Limit must be between 1 and 100'
        }),
    filters: Joi.object()
        .optional()
        .messages({
            'object.base': 'Filters must be an object'
        })
});

module.exports = {
    ingestDataValidator,
    queryDataValidator
};
