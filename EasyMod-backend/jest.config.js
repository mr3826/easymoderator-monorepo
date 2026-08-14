module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
    testPathIgnorePatterns: [
        '/node_modules/',
        // Meta-shaped E2E suite — needs PostgreSQL + Redis and the REAL message
        // queue (which the moduleNameMapper below deliberately stubs out here).
        // Runs under jest.meta-e2e.config.js via `npm run test:meta:e2e`.
        'tests/meta-e2e/',
        // ── Pre-existing broken tests (never ran in CI — paths-filter workflow skipped them)
        // These need dedicated fixes and are tracked separately.
        // Integration tests that require a real database connection
        'subscription/__tests__/usage-tracking.test.js',
        // Uses chai (ESM-only) and requires live DB — true integration test
        'tests/smart-payment-detection.test.js',
        // Long-running E2E test (>5min) — requires live infrastructure
        'tests/features/voice-processing.test.js',
        // customer-intelligence.test.js is not present in this checkout.
        // Full app integration tests — require live DB + Redis + running server
        'src/modules/ai/__tests__/chatbot-rag.test.js',
        // Auth HTTP and TOTP suites are hermetic after their cache/queue
        // fixtures were isolated and run in the default Jest gate.
        // Order/Product/Shop tests — require full app context + DB
        'src/modules/order/__tests__/order.controller.test.js',
        'src/modules/order/__tests__/order.api.integration.test.js',
        'src/modules/order/__tests__/order-cancel-inventory.test.js',
        'src/modules/order/__tests__/order-tracking.service.test.js',
        'src/modules/product/__tests__/product-inventory.test.js',
        'src/modules/product/__tests__/product.api.integration.test.js',
        'src/modules/shop/__tests__/shop.api.integration.test.js',
        'src/modules/shop/__tests__/shop.service.test.js',
        'src/modules/shop/__tests__/ai-settings.test.js',
        'src/modules/notification/__tests__/notification.api.integration.test.js',
        'src/modules/notification/__tests__/notification.controller.test.js',
        'src/modules/customer/__tests__/customer.service.test.js',
    ],
    moduleNameMapper: {
        '^src/(.*)$': '<rootDir>/src/$1',
        // Redirect all message-queue imports to a stub so BullMQ never opens
        // a real Redis connection during unit tests (path varies: ../../jobs/...,
        // ../src/jobs/..., src/jobs/... — the regex catches all forms).
        '.*/jobs/message-queue$': '<rootDir>/tests/__mocks__/message-queue.js',
    },
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/database/migrations/**',
        '!src/scripts/**',
        '!src/jobs/test-jobs.js',
        '!src/**/*.update.js',          // WIP draft files with TypeScript syntax
        '!src/**/*.latency-failover.js', // Experimental stub files
    ],
    coverageReporters: ['text', 'lcov'],
    testTimeout: 10000
};
