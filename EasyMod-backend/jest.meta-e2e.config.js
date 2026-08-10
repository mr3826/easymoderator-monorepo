/**
 * Jest config for the Meta-shaped E2E suite.
 *
 * Separate from jest.config.js on purpose:
 *   - the unit config redirects every `jobs/message-queue` import to a stub so
 *     BullMQ never opens a Redis connection. This suite needs the REAL queue.
 *   - these tests need PostgreSQL and Redis, so they must not run in the unit
 *     job (jest.config.js ignores tests/meta-e2e/ for the same reason).
 *
 * Requires: a disposable Postgres database (name must contain "e2e" or "test")
 * and a Redis instance. See docs/testing/META_E2E_TEST_SETUP.md.
 */
module.exports = {
    testEnvironment: 'node',
    rootDir: __dirname,
    testMatch: ['<rootDir>/tests/meta-e2e/**/*.test.js'],
    // env.js must run before any application module captures process.env.
    setupFiles: ['<rootDir>/tests/meta-e2e/env.js'],
    moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
    // Shared Postgres/Redis state — one worker, one scenario at a time.
    maxWorkers: 1,
    testTimeout: 120000,
    collectCoverage: false,
};
