'use strict';

const Joi = require('joi');

const nativeSigninValidator = Joi.object({
    email: Joi.string()
        .email({ tlds: { allow: false } })
        .lowercase()
        .required()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required',
        }),
    password: Joi.string()
        .required()
        .messages({
            'any.required': 'Password is required',
            'string.empty': 'Password is required',
        }),
});

const native2faVerifyValidator = Joi.object({
    tempToken: Joi.string().required().messages({ 'any.required': 'tempToken is required' }),
    token: Joi.string().required().messages({ 'any.required': 'token is required' }),
});

const nativeRefreshValidator = Joi.object({
    // Unlike the web refresh validator, this is required: native refresh has
    // no cookie fallback by design (ADR M-004).
    refresh_token: Joi.string().required().messages({
        'any.required': 'refresh_token is required',
        'string.empty': 'refresh_token is required',
    }),
});

const switchShopValidator = Joi.object({
    shopId: Joi.string().required().messages({ 'any.required': 'shopId is required' }),
});

module.exports = {
    nativeSigninValidator,
    native2faVerifyValidator,
    nativeRefreshValidator,
    switchShopValidator,
};
