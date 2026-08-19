/**
 * Jest config for the quarantine suite: tracked tests that are real but not yet
 * repaired.
 *
 * These do NOT count as coverage. The point of running them under their own
 * command is that "what is broken, and why" is one command away rather than an
 * invisible line in an ignore array — which is exactly how 18 test files went
 * unnoticed for months.
 *
 * Membership, causes and repairs are in tests/quarantine.json, which
 * jest.config.js also reads so a file can never be in both suites.
 *
 * Expected to FAIL. CI runs it for visibility and does not gate on it.
 */
const quarantined = require('./tests/quarantine.json').files.map((f) => f.file);

module.exports = {
    testEnvironment: 'node',
    rootDir: __dirname,
    testMatch: quarantined.map((f) => `<rootDir>/${f}`),
    testPathIgnorePatterns: ['/node_modules/'],
    // Same stubs as the unit gate, so a repaired file behaves identically the
    // moment it is moved out of quarantine.
    moduleNameMapper: {
        '^src/(.*)$': '<rootDir>/src/$1',
        '.*/jobs/message-queue$': '<rootDir>/tests/__mocks__/message-queue.js',
    },
    collectCoverage: false,
    testTimeout: 30000,
};
