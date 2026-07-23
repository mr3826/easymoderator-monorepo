'use strict';

const request = require('supertest');

describe('app auth attempt rate limiting', () => {
    const originalEnv = { ...process.env };

    const loadApp = () => {
        jest.resetModules();
        process.env = {
            ...originalEnv,
            NODE_ENV: 'production',
            CORS_ORIGINS: 'https://easymod.tech',
            DATABASE_URL: 'postgresql://user:pass@localhost:5432/easymod_test',
            REDIS_URL: 'redis://localhost:6379',
            FRONTEND_URL: 'https://easymod.tech',
            BASE_URL: 'https://api.easymod.tech',
            JWT_ACCESS_SECRET: 'test-access-secret-strong-value-0001',
            JWT_REFRESH_SECRET: 'test-refresh-secret-strong-value-0002',
            SESSION_SECRET: 'test-session-secret-strong-value-0003',
            CSRF_SECRET: 'test-csrf-secret-strong-value-0000004',
            META_WEBHOOK_VERIFY_TOKEN: 'test-meta-verify-token-strong-value-05',
            PAYMENT_ENCRYPTION_KEY: '1'.repeat(64),
            DELIVERY_ENCRYPTION_KEY: '2'.repeat(64),
            CHANNEL_ENCRYPTION_KEY: '3'.repeat(64),
            META_APP_ID: '1234567890',
            META_APP_SECRET: 'test-meta-app-secret-strong-value-0006',
            META_OAUTH_REDIRECT_URI: 'https://api.easymod.tech/api/channels/meta/oauth/callback',
            PAYMENT_CALLBACK_HMAC_SECRET: 'test-payment-callback-strong-value-007',
            BKASH_WEBHOOK_SECRET: 'test-bkash-webhook-strong-value-0008',
            RESEND_API_KEY: 're_test_only_not_a_real_key',
            EMAIL_FROM: 'security-test@easymod.tech',
            SENTRY_DSN: 'https://public@test.ingest.sentry.invalid/1',
            OPENAI_API_KEY: 'test-only-not-a-real-key',
            BODY_SIZE_LIMIT: '1mb',
        };

        jest.doMock('src/config/redis', () => ({
            sessionRedis: null,
            cacheRedis: null,
            rateLimitRedis: null,
            legacyRedis: null,
            closeAllRedis: jest.fn(),
            checkRedisAvailability: jest.fn(() => ({})),
        }));
        jest.doMock('src/utils/cache.service', () => ({
            getForShop: jest.fn(() => Promise.resolve(null)),
            setForShop: jest.fn(() => Promise.resolve()),
            deleteForShop: jest.fn(() => Promise.resolve()),
        }));
        jest.doMock('src/modules/subscription/subscription.plans', () => ({
            getTierByCode: jest.fn(() => ({ features: { rate_limit_per_minute: 200 } })),
        }));
        jest.doMock('src/modules/entities', () => ({
            Subscription: { findOne: jest.fn(() => Promise.resolve(null)) },
        }));
        jest.doMock('src/middleware/session.middleware', () => () => (_req, _res, next) => next());
        jest.doMock('src/middleware/csrf-middleware', () => ({
            csrfTokenHandler: (_req, res) => res.json({ token: 'test' }),
            csrfProtectionMiddleware: (_req, _res, next) => next(),
            csrfDebugHandler: (_req, res) => res.json({ ok: true }),
        }));
        jest.doMock('src/middleware/xss-sanitize.middleware', () => (_req, _res, next) => next());
        jest.doMock('src/middleware/request-context.middleware', () => ({
            requestContextMiddleware: (_req, _res, next) => next(),
        }));
        jest.doMock('src/config/sentry', () => ({
            initSentry: jest.fn(),
            sentryCaptureException: jest.fn(),
        }));
        jest.doMock('src/routes/health.routes', () => {
            const express = require('express');
            return express.Router();
        });
        jest.doMock('src/routes/version.routes', () => {
            const express = require('express');
            const router = express.Router();
            router.get('/', (_req, res) => res.json({ gitSha: 'test' }));
            return router;
        });
        jest.doMock('src/modules/integration/meta-webhook.routes', () => {
            const express = require('express');
            return express.Router();
        });
        jest.doMock('src/modules/webhooks/courier-webhook.routes', () => {
            const express = require('express');
            return express.Router();
        });
        jest.doMock('src/modules/webhooks/payment-webhook.routes', () => {
            const express = require('express');
            return express.Router();
        });
        jest.doMock('src/modules/webhooks/telegram-webhook.routes', () => {
            const express = require('express');
            return express.Router();
        });
        jest.doMock('src/modules/routes', () => {
            const express = require('express');
            const router = express.Router();
            router.get('/auth/me', (_req, res) => res.json({ success: true }));
            router.post('/auth/signin', (_req, res) => res.json({ success: true }));
            return router;
        });

        return require('src/app');
    };

    afterEach(() => {
        process.env = originalEnv;
        jest.dontMock('src/config/redis');
        jest.dontMock('src/utils/cache.service');
        jest.dontMock('src/modules/subscription/subscription.plans');
        jest.dontMock('src/modules/entities');
        jest.dontMock('src/middleware/session.middleware');
        jest.dontMock('src/middleware/csrf-middleware');
        jest.dontMock('src/middleware/xss-sanitize.middleware');
        jest.dontMock('src/middleware/request-context.middleware');
        jest.dontMock('src/config/sentry');
        jest.dontMock('src/routes/health.routes');
        jest.dontMock('src/routes/version.routes');
        jest.dontMock('src/modules/integration/meta-webhook.routes');
        jest.dontMock('src/modules/webhooks/courier-webhook.routes');
        jest.dontMock('src/modules/webhooks/payment-webhook.routes');
        jest.dontMock('src/modules/webhooks/telegram-webhook.routes');
        jest.dontMock('src/modules/routes');
    });

    test('burst GET /api/auth/me checks do not consume the brute-force auth limiter', async () => {
        const app = loadApp();

        const results = [];
        for (let i = 0; i < 15; i += 1) {
            results.push(await request(app).get('/api/auth/me'));
        }

        expect(results.every((res) => res.status === 200)).toBe(true);
    });

    test('non-session auth attempts still receive 429 after the auth limiter threshold', async () => {
        const app = loadApp();

        const statuses = [];
        for (let i = 0; i < 11; i += 1) {
            statuses.push((await request(app).post('/api/auth/signin')).status);
        }

        expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true);
        expect(statuses.at(-1)).toBe(429);
    });
});
