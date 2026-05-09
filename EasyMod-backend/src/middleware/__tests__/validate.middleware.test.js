'use strict';

// AppError pulls in structured-logger which logs to stdout during tests.
// Suppress noise by mocking the logger with no-op functions.
jest.mock('../../utils/structured-logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
    StructuredLogger: jest.fn(),
}));

const Joi = require('joi');
const validate = require('../validate.middleware');
const { AppError } = require('../../utils/AppError');

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express req object.
 */
const makeReq = (overrides = {}) => ({
    body: {},
    params: {},
    query: {},
    ...overrides,
});

// ─── single body schema ──────────────────────────────────────────────────────

describe('validate() — single Joi body schema', () => {
    const schema = Joi.object({
        name: Joi.string().required(),
        age: Joi.number().integer().min(0),
    });

    test('valid body → calls next() with no arguments', () => {
        const req = makeReq({ body: { name: 'Alice', age: 25 } });
        const next = jest.fn();

        validate(schema)(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(); // no error
    });

    test('invalid body (missing required field) → calls next(AppError) with status 400', () => {
        const req = makeReq({ body: { age: 25 } }); // name is missing
        const next = jest.fn();

        validate(schema)(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(AppError);
        expect(err.status).toBe(400);
    });

    test('invalid body → error message mentions the failing field', () => {
        const req = makeReq({ body: { age: -1 } }); // name missing, age invalid
        const next = jest.fn();

        validate(schema)(req, {}, next);

        const err = next.mock.calls[0][0];
        expect(err.message).toBeTruthy();
        expect(typeof err.message).toBe('string');
    });

    test('body schema strips unknown fields from req.body', () => {
        const req = makeReq({ body: { name: 'Bob', age: 30, extra: 'unwanted' } });
        const next = jest.fn();

        validate(schema)(req, {}, next);

        expect(next).toHaveBeenCalledWith(); // no error — unknown stripped
        expect(req.body).not.toHaveProperty('extra');
        expect(req.body.name).toBe('Bob');
    });

    test('valid value is written back to req.body after coercion', () => {
        const coerceSchema = Joi.object({ count: Joi.number().required() });
        // Joi coerces the string "5" to number 5
        const req = makeReq({ body: { count: '5' } });
        const next = jest.fn();

        validate(coerceSchema)(req, {}, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.body.count).toBe(5); // coerced from string
    });
});

// ─── schema map { body, params, query } ──────────────────────────────────────

describe('validate() — schema map with body and params', () => {
    const bodySchema = Joi.object({ title: Joi.string().required() });
    const paramsSchema = Joi.object({ id: Joi.number().integer().required() });

    test('both body and params valid → calls next() with no arguments', () => {
        const req = makeReq({
            body: { title: 'Hello' },
            params: { id: '42' }, // Joi coerces string '42' to number
        });
        const next = jest.fn();

        validate({ body: bodySchema, params: paramsSchema })(req, {}, next);

        expect(next).toHaveBeenCalledWith();
    });

    test('invalid body with valid params → calls next(AppError) 400', () => {
        const req = makeReq({
            body: {},            // missing title
            params: { id: 1 },
        });
        const next = jest.fn();

        validate({ body: bodySchema, params: paramsSchema })(req, {}, next);

        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(AppError);
        expect(err.status).toBe(400);
    });

    test('valid body with invalid params → calls next(AppError) 400', () => {
        const req = makeReq({
            body: { title: 'Hello' },
            params: { id: 'not-a-number' },
        });
        const next = jest.fn();

        validate({ body: bodySchema, params: paramsSchema })(req, {}, next);

        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(AppError);
        expect(err.status).toBe(400);
    });

    test('multiple validation errors produce a joined semicolon-delimited message', () => {
        const multiSchema = Joi.object({
            a: Joi.string().required(),
            b: Joi.number().required(),
        });
        const req = makeReq({ body: {} }); // both a and b missing → two errors
        const next = jest.fn();

        validate(multiSchema)(req, {}, next);

        const err = next.mock.calls[0][0];
        // abortEarly:false means multiple messages; they are joined with '; '
        expect(err.message).toContain(';');
    });
});

// ─── query schema — allowUnknown ─────────────────────────────────────────────

describe('validate() — query schema allows unknown fields', () => {
    const querySchema = Joi.object({ page: Joi.number().integer().min(1) });

    test('query with known and unknown fields → next() called without error', () => {
        const req = makeReq({ query: { page: 2, unknownParam: 'foo' } });
        const next = jest.fn();

        validate({ query: querySchema })(req, {}, next);

        expect(next).toHaveBeenCalledWith(); // unknown keys allowed for query
    });

    test('invalid known query field → 400 AppError', () => {
        const req = makeReq({ query: { page: 0 } }); // min is 1
        const next = jest.fn();

        validate({ query: querySchema })(req, {}, next);

        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(AppError);
        expect(err.status).toBe(400);
    });
});
