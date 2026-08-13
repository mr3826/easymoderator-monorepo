/**
 * Jest config for the backend integration suite.
 *
 * Separate from jest.config.js on purpose: these tests talk to a REAL
 * PostgreSQL (and Redis where the code path needs it), so they cannot run in
 * the unit gate — which stubs the message queue and assumes no service is
 * listening.
 *
 * Membership is by filename, not by an exclusion list: a test named
 * `*.integration.test.js` runs here and nowhere else. That is the whole
 * convention, and tests/__tests__/test-discovery.test.js enforces it.
 *
 * Requires: a disposable Postgres database (name must contain "test" or "e2e"
 * as a whole word — see tests/helpers/disposable-database.js) and Redis.
 */
module.exports = {
    testEnvironment: 'node',
    rootDir: __dirname,
    testMatch: ['<rootDir>/**/*.integration.test.js'],
    testPathIgnorePatterns: ['/node_modules/'],
    // env.js must run before any application module captures process.env, and
    // before anything can issue a destructive statement — it holds the
    // disposable-database guard.
    setupFiles: ['<rootDir>/tests/integration/env.js'],
    moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
    // Shared Postgres state — one worker, one scenario at a time.
    maxWorkers: 1,
    testTimeout: 60000,
    collectCoverage: false,
};
