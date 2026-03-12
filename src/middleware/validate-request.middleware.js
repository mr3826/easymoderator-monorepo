const { AppError } = require('../utils/AppError');

/**
 * Middleware to validate request body against a Joi schema
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
const validateRequest = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const messages = error.details.map(detail => detail.message).join(', ');
            console.error('Validation error:', messages);
            return next(new AppError(messages, 400));
        }

        // Replace req.body with validated value
        req.body = value;
        next();
    };
};

module.exports = { validateRequest };
