module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
    testPathIgnorePatterns: [
        '/node_modules/',
        // Integration tests that require a real database connection
        'subscription/__tests__/usage-tracking.test.js'
    ],
    moduleNameMapper: {
        '^src/(.*)$': '<rootDir>/src/$1'
    },
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/database/migrations/**',
        '!src/scripts/**',
        '!src/jobs/test-jobs.js'
    ],
    coverageReporters: ['text', 'lcov'],
    testTimeout: 10000
};
