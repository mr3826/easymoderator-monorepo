'use strict';

/**
 * The disposable mobile E2E controls must be unreachable in every process
 * except an explicitly configured NODE_ENV=test run against a local,
 * disposable database, and only for a caller holding the per-run token.
 */

const fixtures = require('../mobile-e2e-fixtures');

const TOKEN = 'e2e-control-token-for-unit-tests-0123456789';
const ENABLED_ENV = Object.freeze({
    NODE_ENV: 'test',
    MOBILE_E2E_FIXTURES_ENABLED: 'true',
    MOBILE_E2E_FIXTURES_TOKEN: TOKEN,
    DATABASE_URL: 'postgres://e2e:e2e@127.0.0.1:5432/easymod_mobile_e2e',
});

const requestWith = (token) => ({
    originalUrl: '/api/mobile/e2e/control',
    get: (name) => (name === fixtures.CONTROL_HEADER ? token : undefined),
});

describe('mobile E2E fixture gate', () => {
    test('is enabled only for the complete disposable test configuration', () => {
        expect(fixtures.isMobileE2eFixturesEnabled(ENABLED_ENV)).toBe(true);
    });

    test.each([
        ['production NODE_ENV', { NODE_ENV: 'production' }],
        ['development NODE_ENV', { NODE_ENV: 'development' }],
        ['e2e NODE_ENV (CSRF is only skipped for test)', { NODE_ENV: 'e2e' }],
        ['missing flag', { MOBILE_E2E_FIXTURES_ENABLED: undefined }],
        ['non-literal flag', { MOBILE_E2E_FIXTURES_ENABLED: '1' }],
        ['missing token', { MOBILE_E2E_FIXTURES_TOKEN: undefined }],
        ['short token', { MOBILE_E2E_FIXTURES_TOKEN: 'short-token' }],
        ['remote database host', { DATABASE_URL: 'postgres://e2e:e2e@10.0.0.5:5432/easymod_mobile_e2e' }],
        ['production database name', { DATABASE_URL: 'postgres://e2e:e2e@127.0.0.1:5432/easymod_production_test' }],
        ['non-disposable database name', { DATABASE_URL: 'postgres://e2e:e2e@127.0.0.1:5432/easymod' }],
        ['non-postgres URL', { DATABASE_URL: 'mysql://e2e:e2e@127.0.0.1:3306/easymod_test' }],
        ['missing database URL', { DATABASE_URL: undefined }],
    ])('is disabled for %s', (_label, override) => {
        expect(fixtures.isMobileE2eFixturesEnabled({ ...ENABLED_ENV, ...override })).toBe(false);
    });

    test.each([
        ['the exact token', TOKEN, true],
        ['a wrong token of equal length', `${TOKEN.slice(0, -1)}x`, false],
        ['a prefix of the token', TOKEN.slice(0, 20), false],
        ['the token with a suffix', `${TOKEN}x`, false],
        ['an empty header', '', false],
        ['no header', undefined, false],
    ])('accepts only the per-run control token (%s)', (_label, supplied, expected) => {
        expect(fixtures.hasControlToken(requestWith(supplied), ENABLED_ENV)).toBe(expected);
    });
});

describe('mobile E2E fixture request guard', () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
        fixtures.__resetStateForTests();
    });

    test('answers a disabled process with a plain 404, even for the right token', () => {
        process.env = { ...originalEnv, ...ENABLED_ENV, NODE_ENV: 'production' };

        expect(() => fixtures.assertFixtureControlRequest(requestWith(TOKEN)))
            .toThrow(expect.objectContaining({ status: 404 }));
    });

    test('answers a wrong token with the same 404', () => {
        process.env = { ...originalEnv, ...ENABLED_ENV };

        expect(() => fixtures.assertFixtureControlRequest(requestWith('wrong-token-but-long-enough-0123456789')))
            .toThrow(expect.objectContaining({ status: 404 }));
    });

    test('accepts the right token in an enabled process', () => {
        process.env = { ...originalEnv, ...ENABLED_ENV };

        expect(() => fixtures.assertFixtureControlRequest(requestWith(TOKEN))).not.toThrow();
    });

    test('never injects an API error once the process is no longer enabled', async () => {
        process.env = { ...originalEnv, ...ENABLED_ENV };
        await fixtures.applyControl({ action: 'set-api-error', endpoint: 'today', failures: 3 });
        expect(fixtures.consumeApiError('today')).toBe(true);

        process.env = { ...originalEnv, ...ENABLED_ENV, MOBILE_E2E_FIXTURES_ENABLED: 'false' };
        expect(fixtures.consumeApiError('today')).toBe(false);
    });

    test('bounds injected failures and rejects unknown actions or endpoints', async () => {
        process.env = { ...originalEnv, ...ENABLED_ENV };

        await expect(fixtures.applyControl({ action: 'drop-database' }))
            .rejects.toMatchObject({ status: 400, code: 'MOBILE_E2E_FIXTURE_BAD_ACTION' });
        await expect(fixtures.applyControl({ action: 'set-api-error', endpoint: 'orders', failures: 1 }))
            .rejects.toMatchObject({ status: 400 });
        await expect(fixtures.applyControl({ action: 'set-api-error', endpoint: 'today', failures: 11 }))
            .rejects.toMatchObject({ status: 400 });
        await expect(fixtures.applyControl({ action: 'set-api-error', endpoint: 'today', failures: 0 }))
            .rejects.toMatchObject({ status: 400 });
    });

    test('consumes an injected failure budget exactly', async () => {
        process.env = { ...originalEnv, ...ENABLED_ENV };
        await fixtures.applyControl({ action: 'set-api-error', endpoint: 'both', failures: 2 });

        expect([1, 2, 3].map(() => fixtures.consumeApiError('attention'))).toEqual([true, true, false]);
        expect([1, 2, 3].map(() => fixtures.consumeApiError('today'))).toEqual([true, true, false]);
    });
});
