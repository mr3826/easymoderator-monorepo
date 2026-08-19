'use strict';

/**
 * The guard that stands between a mistyped DATABASE_URL and a merchant's
 * catalog. It is the only thing protecting production from a suite whose
 * normal working state is "truncate everything", so it is tested harder than
 * the suites it protects.
 */

const path = require('path');
const {
    databaseNameFrom,
    isDisposableDatabase,
    assertDisposableDatabase,
} = require('../disposable-database');

const url = (name) => `postgres://user:pw@db.example.com:5432/${name}`;

describe('disposable-database guard', () => {
    describe('rejects production-like databases', () => {
        // If any of these is ever accepted, the suite that calls the guard will
        // truncate a real catalog.
        const PRODUCTION_LIKE = [
            'easymod',
            'easymod_production',
            'easymod_prod',
            'easymod_live',
            'easymod_staging',
            'postgres',
            'defaultdb',
            'main',
            // "latest" CONTAINS "test". A naive /e2e|test/i accepts this one.
            'latest',
            'latest_snapshot',
            // ...as does anything that merely embeds the substring.
            'contested_orders',
            'protester_db',
        ];

        it.each(PRODUCTION_LIKE)('refuses "%s"', (name) => {
            expect(isDisposableDatabase(url(name))).toBe(false);
            expect(() => assertDisposableDatabase(url(name))).toThrow(/refuses to run against/);
        });

        it('names the offending database in the error, so the fix is obvious', () => {
            expect(() => assertDisposableDatabase(url('easymod_production')))
                .toThrow(/easymod_production/);
        });
    });

    describe('accepts provably disposable databases', () => {
        const DISPOSABLE = [
            'easymod_e2e',
            'easymod_test',
            'easymod_integration_test',
            'easymod-test',
            'test',
            'e2e',
            'test_easymod',
        ];

        it.each(DISPOSABLE)('allows "%s"', (name) => {
            expect(isDisposableDatabase(url(name))).toBe(true);
            expect(() => assertDisposableDatabase(url(name))).not.toThrow();
        });

        it('accepts the database CI actually provisions', () => {
            // Keep in step with .github/workflows/ci-cd.yml POSTGRES_DB.
            expect(isDisposableDatabase('postgres://e2e:e2e@127.0.0.1:5432/easymod_e2e')).toBe(true);
        });
    });

    describe('fails closed', () => {
        it.each([
            ['unset', undefined],
            ['empty', ''],
            ['not a URL', 'this-is-not-a-url'],
            ['a bare database name', 'easymod_test'],
            ['null', null],
            ['a number', 5432],
            ['an object', {}],
        ])('refuses when DATABASE_URL is %s', (_label, value) => {
            expect(isDisposableDatabase(value)).toBe(false);
            expect(() => assertDisposableDatabase(value)).toThrow(/refuses to run against/);
        });

        it('refuses the sqlite fallback that database-setup uses when DATABASE_URL is unset', () => {
            expect(isDisposableDatabase('sqlite:./database.sqlite')).toBe(false);
        });

        it('is not satisfied by a type check', () => {
            // The point of the guard: "easymod_production" is a string too.
            const productionUrl = url('easymod_production');
            expect(typeof databaseNameFrom(productionUrl)).toBe('string');
            expect(isDisposableDatabase(productionUrl)).toBe(false);
        });
    });

    describe('runs before anything destructive', () => {
        const ENV_FILE = path.join(__dirname, '../../integration/env.js');

        const loadEnvWith = (databaseUrl) => {
            const saved = process.env.DATABASE_URL;
            const savedNodeEnv = process.env.NODE_ENV;
            if (databaseUrl === undefined) delete process.env.DATABASE_URL;
            else process.env.DATABASE_URL = databaseUrl;
            try {
                jest.isolateModules(() => { require(ENV_FILE); });
            } finally {
                process.env.DATABASE_URL = saved;
                process.env.NODE_ENV = savedNodeEnv;
            }
        };

        it('aborts the integration suite setup on a production-like DATABASE_URL', () => {
            expect(() => loadEnvWith(url('easymod_production')))
                .toThrow(/integration suite refuses to run against/);
        });

        it('aborts before the database module is ever required', () => {
            const dbModule = require.resolve('../../../src/utils/database/database-setup');
            delete require.cache[dbModule];

            expect(() => loadEnvWith(url('easymod_production'))).toThrow();

            // If setup had reached a model, a migration or a truncate, this
            // module would be in the cache — connected, and one statement away
            // from the catalog it was pointed at.
            expect(require.cache[dbModule]).toBeUndefined();
        });

        it('allows setup through on a disposable DATABASE_URL', () => {
            expect(() => loadEnvWith(url('easymod_integration_test'))).not.toThrow();
        });
    });
});
