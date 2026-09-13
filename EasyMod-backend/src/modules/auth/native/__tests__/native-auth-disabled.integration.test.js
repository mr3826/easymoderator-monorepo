'use strict';

/**
 * ADR M-010: MOBILE_API_ENABLED defaults to false, and every
 * /api/auth/native/* route must 404 (not 401/403 — indistinguishable from a
 * route that doesn't exist) while it's off.
 *
 * Deliberately its own file: config.js reads process.env.MOBILE_API_ENABLED
 * once, at first require, so the flag-on and flag-off suites cannot share a
 * module registry. This file must NEVER set MOBILE_API_ENABLED.
 */
delete process.env.MOBILE_API_ENABLED;

const request = require('supertest');
const config = require('../../../../config/config');

const app = require('../../../../app');

describe('native auth routes when MOBILE_API_ENABLED is off (default, ADR M-010)', () => {
    beforeAll(() => {
        // Fail loudly if some other file in this worker already flipped the
        // flag on before this file's module registry was created — this
        // suite is meaningless unless the flag is actually off here.
        expect(config.mobileApiEnabled).toBe(false);
    });

    const routes = [
        ['post', '/api/auth/native/signin'],
        ['post', '/api/auth/native/2fa/verify'],
        ['post', '/api/auth/native/refresh'],
        ['post', '/api/auth/native/logout'],
        ['post', '/api/auth/native/switch-shop'],
        ['get', '/api/auth/native/sessions'],
        ['delete', '/api/auth/native/sessions/00000000-0000-0000-0000-000000000000'],
    ];

    test.each(routes)('%s %s returns 404 when MOBILE_API_ENABLED is off', async (method, path) => {
        const res = await request(app)[method](path).send({});
        expect(res.status).toBe(404);
    });
});
