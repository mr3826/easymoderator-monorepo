'use strict';

const Joi = require('joi');
const { VERIFY_METHODS } = require('./order-confidence.service');

const orderParams = Joi.object({
    orderId: Joi.string().guid({ version: ['uuidv4', 'uuidv5', 'uuidv1'] }).required(),
});

module.exports = {
    getDecision: { params: orderParams },
    verify: {
        params: orderParams,
        body: Joi.object({
            decision_version: Joi.number().integer().min(1).required(),
            method: Joi.string().valid(...VERIFY_METHODS).required(),
            note: Joi.string().trim().max(500).allow('').optional(),
        }),
    },
    approve: {
        params: orderParams,
        body: Joi.object({
            decision_version: Joi.number().integer().min(1).required(),
            note: Joi.string().trim().min(5).max(500).required(),
        }),
    },
    summary: {
        query: Joi.object({
            days: Joi.number().integer().min(1).max(180).default(30),
        }),
    },
};
