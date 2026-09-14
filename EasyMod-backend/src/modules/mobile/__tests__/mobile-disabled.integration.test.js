'use strict';

/**
 * ADR M-010: MOBILE_API_ENABLED defaults to false, and every
 * /api/mobile/* route must 404 (not 401/403 — indistinguishable from a
 * route that doesn't exist) while it's off.
 *
 * Deliberately its own file: config.js reads process.env.MOBILE_API_ENABLED
 * once, at first require, so the flag-on suite (mobile-attention.integration.test.js)
 * and this flag-off suite cannot share a module registry. This file must
 * NEVER set MOBILE_API_ENABLED.
 */
delete process.env.MOBILE_API_ENABLED;

const request = require('supertest');
const config = require('../../../config/config');

const app = require('../../../app');

describe('mobile attention/today routes when MOBILE_API_ENABLED is off (default, ADR M-010)', () => {
    beforeAll(() => {
        // Fail loudly if some other file in this worker already flipped the
        // flag on before this file's module registry was created — this
        // suite is meaningless unless the flag is actually off here.
        expect(config.mobileApiEnabled).toBe(false);
    });

    const routes = [
        ['get', '/api/mobile/attention'],
        ['get', '/api/mobile/today'],
    ];

    test.each(routes)('%s %s returns 404 when MOBILE_API_ENABLED is off', async (method, path) => {
        const res = await request(app)[method](path).send();
        expect(res.status).toBe(404);
        expect(res.body.message).toBe(`Can't find ${path} on this server!`);
    });

    test('is indistinguishable from a genuinely unknown route', async () => {
        const known = await request(app).get('/api/mobile/attention');
        const unknown = await request(app).get('/api/mobile/this-route-does-not-exist');

        // NOTE: known.body.message and unknown.body.message are NOT expected
        // to be byte-equal — both the mobile flag-gate (mobile.routes.js:29)
        // and app.js's global catch-all (app.js:217) embed the caller's own
        // req.originalUrl in the message, so two different paths necessarily
        // produce two different strings. That is not an information leak
        // (the client already knows the path it requested) and comparing the
        // literal strings across two different paths was simply a bug in
        // this test — every request to a genuinely unknown path already gets
        // this same per-path message, asserted for /attention and /today
        // above.
        //
        // What "indistinguishable" actually requires — and what this
        // asserts — is that a flag-gated mobile route and a route that never
        // existed produce the exact same response *shape* (status, success
        // flag, error code) and the exact same message *template*, so
        // nothing here could tell a caller "this route exists but is
        // disabled" apart from "this route was never registered".
        expect(known.status).toBe(unknown.status);
        expect(known.body.success).toBe(unknown.body.success);
        expect(known.body.code).toBe(unknown.body.code);
        expect(known.body.message).toBe(`Can't find /api/mobile/attention on this server!`);
        expect(unknown.body.message).toBe(`Can't find /api/mobile/this-route-does-not-exist on this server!`);
    });
});
