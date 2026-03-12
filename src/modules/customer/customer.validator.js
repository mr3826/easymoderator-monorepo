const Joi = require('joi');

/**
 * Joi schemas for customer validation
 */
class CustomerValidator {
    static createCustomer = Joi.object({
        name: Joi.string()
            .trim()
            .required()
            .max(255)
            .messages({
                'string.empty': 'Customer name is required',
                'string.max': 'Customer name must not exceed 255 characters',
                'any.required': 'Customer name is required'
            }),

        email: Joi.string()
            .trim()
            .email()
            .max(255)
            .optional()
            .messages({
                'string.email': 'Email must be a valid email address',
                'string.max': 'Email must not exceed 255 characters'
            }),

        number: Joi.string()
            .trim()
            .pattern(/^01[3-9]\d{8}$/)
            .required()
            .messages({
                'string.empty': 'Phone number is required',
                'string.pattern.base': 'Must be a valid Bangladeshi mobile number (e.g. 01712345678)',
                'any.required': 'Phone number is required'
            }),

        channel: Joi.string()
            .trim()
            .required()
            .valid('facebook', 'whatsapp', 'telegram', 'webchat', 'manual')
            .messages({
                'string.empty': 'Channel is required',
                'any.only': 'Channel must be one of: facebook, whatsapp, telegram, webchat, manual',
                'any.required': 'Channel is required'
            })
    });

    static updateCustomer = Joi.object({
        customerId: Joi.string()
            .trim()
            .required()
            .uuid()
            .messages({
                'string.empty': 'Customer ID is required',
                'string.uuid': 'Customer ID must be a valid UUID',
                'any.required': 'Customer ID is required'
            }),

        name: Joi.string()
            .trim()
            .optional()
            .max(255)
            .messages({
                'string.empty': 'Customer name cannot be empty',
                'string.max': 'Customer name must not exceed 255 characters'
            }),

        email: Joi.string()
            .trim()
            .email()
            .max(255)
            .optional()
            .messages({
                'string.email': 'Email must be a valid email address',
                'string.max': 'Email must not exceed 255 characters'
            }),

        number: Joi.string()
            .trim()
            .pattern(/^01[3-9]\d{8}$/)
            .optional()
            .messages({
                'string.empty': 'Phone number cannot be empty',
                'string.pattern.base': 'Must be a valid Bangladeshi mobile number (e.g. 01712345678)'
            }),

        channel: Joi.string()
            .trim()
            .valid('facebook', 'whatsapp', 'telegram', 'webchat', 'manual')
            .optional()
            .messages({
                'any.only': 'Channel must be one of: facebook, whatsapp, telegram, webchat, manual'
            })
    });

    static getCustomer = Joi.object({
        customerId: Joi.string()
            .trim()
            .required()
            .uuid()
            .messages({
                'string.empty': 'Customer ID is required',
                'string.uuid': 'Customer ID must be a valid UUID',
                'any.required': 'Customer ID is required'
            })
    });

    static listCustomers = Joi.object({
        search: Joi.string()
            .trim()
            .optional(),

        email: Joi.string()
            .trim()
            .optional(),

        number: Joi.string()
            .trim()
            .optional(),

        channel: Joi.string()
            .valid('facebook', 'whatsapp', 'telegram', 'webchat', 'manual')
            .optional()
            .messages({
                'any.only': 'Channel must be one of: facebook, whatsapp, telegram, webchat, manual'
            }),

        start_date: Joi.date()
            .iso()
            .optional()
            .messages({
                'date.format': 'Start date must be a valid ISO 8601 date'
            }),

        end_date: Joi.date()
            .iso()
            .optional()
            .messages({
                'date.format': 'End date must be a valid ISO 8601 date'
            })
    });

    static getCustomerById = Joi.object({
        id: Joi.string()
            .trim()
            .required()
            .uuid()
            .messages({
                'string.empty': 'Customer ID is required',
                'string.uuid': 'Customer ID must be a valid UUID',
                'any.required': 'Customer ID is required'
            })
    });

    static updateCustomerById = Joi.object({
        name: Joi.string()
            .trim()
            .optional()
            .max(255)
            .messages({
                'string.empty': 'Customer name cannot be empty',
                'string.max': 'Customer name must not exceed 255 characters'
            }),

        email: Joi.string()
            .trim()
            .email()
            .max(255)
            .optional()
            .messages({
                'string.email': 'Email must be a valid email address',
                'string.max': 'Email must not exceed 255 characters'
            }),

        number: Joi.string()
            .trim()
            .pattern(/^01[3-9]\d{8}$/)
            .optional()
            .messages({
                'string.empty': 'Phone number cannot be empty',
                'string.pattern.base': 'Must be a valid Bangladeshi mobile number (e.g. 01712345678)'
            }),

        channel: Joi.string()
            .trim()
            .valid('facebook', 'whatsapp', 'telegram', 'webchat', 'manual')
            .optional()
            .messages({
                'any.only': 'Channel must be one of: facebook, whatsapp, telegram, webchat, manual'
            })
    });

    static deleteCustomerById = Joi.object({
        id: Joi.string()
            .trim()
            .required()
            .uuid()
            .messages({
                'string.empty': 'Customer ID is required',
                'string.uuid': 'Customer ID must be a valid UUID',
                'any.required': 'Customer ID is required'
            })
    });
}

module.exports = CustomerValidator;
