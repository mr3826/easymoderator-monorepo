'use strict';

const { body, header } = require('express-validator');

const isPlainObject = value => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const idempotencyHeader = name => header(name)
    .optional()
    .isString().withMessage(`${name} must be a string`)
    .bail()
    .isLength({ min: 10, max: 128 }).withMessage(`${name} must be between 10 and 128 characters`)
    .bail()
    .matches(/^[\x21-\x7E]+$/).withMessage(`${name} must contain visible ASCII characters without spaces`);

const validateFunnelEvent = [
    body().custom(isPlainObject).withMessage('request body must be an object'),
    body('event')
        .exists().withMessage('event is required')
        .bail()
        .isString().withMessage('event must be a string')
        .bail()
        .isLength({ min: 1, max: 64 }).withMessage('event must be between 1 and 64 characters'),
    body('metadata')
        .optional({ values: 'null' })
        .custom(isPlainObject).withMessage('metadata must be an object'),
    body('sessionId')
        .optional({ values: 'null' })
        .isString().withMessage('sessionId must be a string')
        .bail()
        .isLength({ max: 80 }).withMessage('sessionId must not exceed 80 characters'),
    body('path')
        .optional({ values: 'null' })
        .isString().withMessage('path must be a string')
        .bail()
        .isLength({ max: 500 }).withMessage('path must not exceed 500 characters'),
    idempotencyHeader('idempotency-key'),
    idempotencyHeader('x-idempotency-key'),
];

module.exports = {
    validateFunnelEvent,
};
