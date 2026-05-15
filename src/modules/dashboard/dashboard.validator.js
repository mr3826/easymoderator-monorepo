const Joi = require('joi');

/**
 * Joi schemas for dashboard validation
 */
class DashboardValidator {
    static getDashboardMetrics = {
        // No specific validation needed for basic metrics request
        // Could add date range validation if needed in the future
    };

    static getDashboardMetricsById = {
        params: Joi.object({
            id: Joi.string()
                .trim()
                .required()
                .uuid()
                .messages({
                    'string.empty': 'Dashboard ID is required',
                    'string.uuid': 'Dashboard ID must be a valid UUID',
                    'any.required': 'Dashboard ID is required'
                })
        })
    };
}

module.exports = DashboardValidator;
