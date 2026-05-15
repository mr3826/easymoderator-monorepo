const Joi = require('joi');

/**
 * Validator for COD payment confirmation
 */
const confirmCodPaymentValidator = Joi.object({
    orderId: Joi.string()
        .uuid()
        .required()
        .messages({
            'string.guid': 'Order ID must be a valid UUID',
            'any.required': 'Order ID is required',
            'string.empty': 'Order ID is required'
        })
});

/**
 * Validator for saving payment configuration
 */
const savePaymentConfigValidator = Joi.object({
    gateway: Joi.string()
        .valid('cod', 'self-mfs', 'bkash', 'nagad', 'rocket')
        .required()
        .messages({
            'any.only': 'Invalid payment gateway',
            'any.required': 'Gateway is required',
            'string.empty': 'Gateway is required'
        }),
    is_enabled: Joi.boolean()
        .optional()
        .messages({
            'boolean.base': 'is_enabled must be a boolean'
        }),
    credentials: Joi.object()
        .optional()
        .messages({
            'object.base': 'Credentials must be an object'
        }),
    config: Joi.object()
        .optional()
        .messages({
            'object.base': 'Config must be an object'
        })
});

module.exports = {
    confirmCodPaymentValidator,
    savePaymentConfigValidator
};
