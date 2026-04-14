const Joi = require('joi');

const signupValidator = Joi.object({
    email: Joi.string()
        .email({ tlds: { allow: false } })
        .lowercase()
        .required()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required'
        }),
    password: Joi.string()
        .min(8)
        .pattern(/[A-Z]/, 'uppercase')
        .pattern(/[0-9]/, 'digit')
        .pattern(/[^A-Za-z0-9]/, 'special')
        .required()
        .messages({
            'string.min': 'Password must be at least 8 characters long',
            'string.pattern.name': 'Password must contain at least one {{#name}} character',
            'any.required': 'Password is required'
        }),
    full_name: Joi.string()
        .trim()
        .min(2)
        .optional()
        .messages({
            'string.min': 'Full name must be at least 2 characters long'
        }),
    phone: Joi.string()
        .trim()
        .optional()
});

const signinValidator = Joi.object({
    email: Joi.string()
        .email({ tlds: { allow: false } })
        .lowercase()
        .required()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required'
        }),
    password: Joi.string()
        .required()
        .messages({
            'any.required': 'Password is required',
            'string.empty': 'Password is required'
        })
});

const refreshTokenValidator = Joi.object({
    refresh_token: Joi.string()
        .optional()
        .messages({
            'string.empty': 'Refresh token cannot be empty'
        })
});

const forgotPasswordValidator = Joi.object({
    email: Joi.string()
        .email({ tlds: { allow: false } })
        .lowercase()
        .required()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required'
        })
});

const resetPasswordValidator = Joi.object({
    token: Joi.string()
        .required()
        .messages({
            'any.required': 'Reset token is required',
            'string.empty': 'Reset token is required'
        }),
    password: Joi.string()
        .min(8)
        .pattern(/[A-Z]/, 'uppercase')
        .pattern(/[0-9]/, 'digit')
        .pattern(/[^A-Za-z0-9]/, 'special')
        .required()
        .messages({
            'string.min': 'Password must be at least 8 characters long',
            'string.pattern.name': 'Password must contain at least one {{#name}} character',
            'any.required': 'Password is required'
        })
});

module.exports = {
    signupValidator,
    signinValidator,
    refreshTokenValidator,
    forgotPasswordValidator,
    resetPasswordValidator
};
