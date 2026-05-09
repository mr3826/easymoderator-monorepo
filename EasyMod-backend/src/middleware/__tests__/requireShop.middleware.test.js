'use strict';

/**
 * requireShop middleware — pure function tests (no mocks needed).
 *
 * The middleware reads req.user.shopId.  If shopId is falsy it responds
 * immediately with 400 + VALIDATION_ERROR.  Otherwise it calls next().
 */

const { requireShop } = require('../requireShop.middleware');

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a res mock that captures status() and json() calls.
 */
const makeRes = () => {
    let capturedStatus;
    let capturedBody;

    const json = jest.fn(body => { capturedBody = body; });
    const status = jest.fn(code => {
        capturedStatus = code;
        return { json };
    });

    return {
        status,
        get capturedStatus() { return capturedStatus; },
        get capturedBody() { return capturedBody; },
        get jsonMock() { return json; },
    };
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe('requireShop middleware', () => {
    test('shopId present → calls next()', () => {
        const req = { user: { shopId: 'shop_abc123' } };
        const res = makeRes();
        const next = jest.fn();

        requireShop(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(); // no error arg
        expect(res.status).not.toHaveBeenCalled();
    });

    test('shopId is null → responds with status 400', () => {
        const req = { user: { shopId: null } };
        const res = makeRes();
        const next = jest.fn();

        requireShop(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.jsonMock).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('shopId is undefined → responds with status 400', () => {
        const req = { user: {} }; // shopId is undefined (destructured as undefined)
        const res = makeRes();
        const next = jest.fn();

        requireShop(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
    });

    test('req.user is undefined → throws or responds with 400 (middleware guards shopId access)', () => {
        const req = {}; // no user — destructuring req.user.shopId will throw
        const res = makeRes();
        const next = jest.fn();

        // The middleware does `const { shopId } = req.user;`
        // When req.user is undefined this throws a TypeError.
        // We assert that it throws (the error handler would catch this in production).
        expect(() => requireShop(req, res, next)).toThrow(TypeError);
    });

    test('400 response body has { success: false, error: { code: "VALIDATION_ERROR" } }', () => {
        const req = { user: { shopId: null } };
        const res = makeRes();
        const next = jest.fn();

        requireShop(req, res, next);

        const body = res.capturedBody;
        expect(body).toMatchObject({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
            },
        });
    });

    test('400 response body contains a human-readable message', () => {
        const req = { user: { shopId: undefined } };
        const res = makeRes();
        const next = jest.fn();

        requireShop(req, res, next);

        expect(res.capturedBody.error.message).toBeTruthy();
        expect(typeof res.capturedBody.error.message).toBe('string');
    });
});
