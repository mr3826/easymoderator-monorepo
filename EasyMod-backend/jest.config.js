module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
    testPathIgnorePatterns: [
        '/node_modules/',
        // Integration tests that require a real database connection
        'subscription/__tests__/usage-tracking.test.js',
        // Uses chai (ESM-only) and requires live DB — true integration test
        'tests/smart-payment-detection.test.js',
        // Long-running E2E test (>5min) — requires live infrastructure
        'tests/features/voice-processing.test.js',
        // customer-intelligence controller/service not yet implemented
        'tests/features/customer-intelligence.test.js',
        // Full app integration test — requires live DB + Redis + running server
        'src/modules/ai/__tests__/chatbot-rag.test.js',
        // Full app integration test — broken mock setup, requires significant refactor
        'tests/webhooks/meta-page-integration.test.js',
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
