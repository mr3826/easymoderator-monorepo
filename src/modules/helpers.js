const Joi = require('joi');

/**
 * Joi validation middleware factory
 * @param {Object} schema - Joi validation schema with keys: body, query, params
 * @returns {Function} Express middleware function
 */
const validate = (schema) => {
    return (req, res, next) => {
        const errors = [];

        // Validate request body
        if (schema.body) {
            const { error, value } = schema.body.validate(req.body, { abortEarly: false });
            if (error) {
                errors.push(...error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    location: 'body'
                })));
            } else {
                req.body = value;
            }
        }

        // Validate query parameters
        if (schema.query) {
            const { error, value } = schema.query.validate(req.query, { abortEarly: false });
            if (error) {
                errors.push(...error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    location: 'query'
                })));
            } else {
                req.query = value;
            }
        }

        // Validate route parameters
        if (schema.params) {
            const { error, value } = schema.params.validate(req.params, { abortEarly: false });
            if (error) {
                errors.push(...error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    location: 'params'
                })));
            } else {
                req.params = value;
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Request validation failed',
                    details: errors
                }
            });
        }

        next();
    };
};

module.exports = {
    validate
};
