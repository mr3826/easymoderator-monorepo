module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
    testPathIgnorePatterns: [
        '/node_modules/',
        // ── Pre-existing broken tests (never ran in CI — paths-filter workflow skipped them)
        // These need dedicated fixes and are tracked separately.
        // Integration tests that require a real database connection
        'subscription/__tests__/usage-tracking.test.js',
        // Uses chai (ESM-only) and requires live DB — true integration test
        'tests/smart-payment-detection.test.js',
        // Long-running E2E test (>5min) — requires live infrastructure
        'tests/features/voice-processing.test.js',
        // customer-intelligence controller/service not yet implemented
        'tests/features/customer-intelligence.test.js',
        // Full app integration tests — require live DB + Redis + running server
        'src/modules/ai/__tests__/chatbot-rag.test.js',
        // Auth tests have ordering/isolation bugs needing investigation
        'src/modules/auth/__tests__/auth.test.js',
        'src/modules/auth/__tests__/totp.service.test.js',
        // Dead tests deleted in Phase 5 Step 2 (these files no longer exist):
        // tests/meta-integration.test.js, tests/webhooks/meta-webhook.test.js,
        // src/modules/integration/__tests__/meta.service.test.js
        // Campaign module tests — module deleted in active branch
        'src/jobs/__tests__/campaign-sender.job.test.js',
        'src/modules/campaign/__tests__/campaign.api.integration.test.js',
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
