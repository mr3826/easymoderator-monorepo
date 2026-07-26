'use strict';

const {
    assertProductionConfig,
    validateProductionConfig,
} = require('../production-config.validator');

function validEnv(overrides = {}) {
    const secret = (letter) => letter.repeat(64);
    return {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@postgres:5432/easymod',
        REDIS_URL: 'redis://redis:6379',
        JWT_ACCESS_SECRET: secret('a'),
        JWT_REFRESH_SECRET: secret('b'),
        SESSION_SECRET: secret('c'),
        CSRF_SECRET: secret('d'),
        CORS_ORIGINS: 'https://easymod.tech',
        FRONTEND_URL: 'https://easymod.tech',
        BASE_URL: 'https://easymod.tech',
        META_APP_ID: '123456789',
        META_APP_SECRET: secret('e'),
        META_WEBHOOK_VERIFY_TOKEN: secret('f'),
        META_OAUTH_REDIRECT_URI: 'https://easymod.tech/app/channels/oauth-callback',
        PAYMENT_ENCRYPTION_KEY: secret('1'),
        DELIVERY_ENCRYPTION_KEY: secret('2'),
        CHANNEL_ENCRYPTION_KEY: secret('3'),
        PAYMENT_CALLBACK_HMAC_SECRET: secret('g'),
        BKASH_WEBHOOK_SECRET: secret('h'),
        RESEND_API_KEY: 're_test_key',
        EMAIL_FROM: 'EasyModerator <no-reply@easymod.tech>',
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        OPENAI_API_KEY: 'test-openai-key',
        BKASH_ENABLED: 'false',
        ...overrides,
    };
}

describe('production configuration validation', () => {
    test('accepts a safe core launch configuration', () => {
        expect(validateProductionConfig(validEnv())).toMatchObject({ valid: true });
    });

    test('fails with variable names only when required security values are missing', () => {
        const env = validEnv();
        delete env.PAYMENT_CALLBACK_HMAC_SECRET;
        delete env.CSRF_SECRET;
        const result = validateProductionConfig(env);
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(expect.arrayContaining([
            'CSRF_SECRET',
            'PAYMENT_CALLBACK_HMAC_SECRET',
        ]));
        expect(() => assertProductionConfig(env)).toThrow(/CSRF_SECRET/);
    });

    test('bKash disabled does not require BKASH_WEBHOOK_SECRET (moved out of core)', () => {
        const env = validEnv({ BKASH_ENABLED: 'false' });
        delete env.BKASH_WEBHOOK_SECRET;
        const result = validateProductionConfig(env);
        expect(result.valid).toBe(true);
        expect(result.missing).not.toContain('BKASH_WEBHOOK_SECRET');
        expect(result.requirements).not.toContain('BKASH_WEBHOOK_SECRET');
    });

    test('bKash enabled requires BKASH_WEBHOOK_SECRET again', () => {
        const env = validEnv({
            BKASH_ENABLED: 'true',
            BKASH_BASE_URL: 'https://tokenized.pay.bka.sh',
            BKASH_USERNAME: 'user',
            BKASH_PASSWORD: 'pass',
            BKASH_APP_KEY: 'app-key',
            BKASH_APP_SECRET: 'app-secret',
            BKASH_SANDBOX: 'false',
        });
        delete env.BKASH_WEBHOOK_SECRET;
        const result = validateProductionConfig(env);
        expect(result.valid).toBe(false);
        expect(result.missing).toContain('BKASH_WEBHOOK_SECRET');
    });

    test('requires the full live bKash set when enabled', () => {
        const result = validateProductionConfig(validEnv({
            BKASH_ENABLED: 'true',
            BKASH_SANDBOX: 'true',
        }));
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(expect.arrayContaining([
            'BKASH_APP_KEY',
            'BKASH_APP_SECRET',
            'BKASH_USERNAME',
        ]));
        expect(result.invalid).toContain('BKASH_SANDBOX');
    });

    test('rejects example placeholders in integration-required values', () => {
        const result = validateProductionConfig(validEnv({
            BKASH_ENABLED: 'true',
            BKASH_BASE_URL: 'https://tokenized.pay.bka.sh',
            BKASH_USERNAME: 'CHANGE_ME',
            BKASH_PASSWORD: 'not-a-placeholder',
            BKASH_APP_KEY: 'CHANGE_ME',
            BKASH_APP_SECRET: 'not-a-placeholder',
            BKASH_SANDBOX: 'false',
        }));
        expect(result.invalid).toEqual(expect.arrayContaining([
            'BKASH_APP_KEY',
            'BKASH_USERNAME',
        ]));
    });

    test('rejects the literal JWT and session defaults published in .env.example', () => {
        const result = validateProductionConfig(validEnv({
            JWT_ACCESS_SECRET: 'your-access-secret-key-change-in-production',
            JWT_REFRESH_SECRET: 'your-refresh-secret-key-change-in-production',
            SESSION_SECRET: 'your-session-secret-change-in-production',
        }));

        expect(result.valid).toBe(false);
        expect(result.invalid).toEqual(expect.arrayContaining([
            'JWT_ACCESS_SECRET',
            'JWT_REFRESH_SECRET',
            'SESSION_SECRET',
        ]));
    });

    test('requires either Sentry or Slack and either OpenAI or Gemini', () => {
        const result = validateProductionConfig(validEnv({
            SENTRY_DSN: '',
            SLACK_ALERT_WEBHOOK_URL: '',
            OPENAI_API_KEY: '',
            GEMINI_API_KEY: '',
        }));
        expect(result.missing).toEqual(expect.arrayContaining([
            'SENTRY_DSN|SLACK_ALERT_WEBHOOK_URL',
            'OPENAI_API_KEY|GEMINI_API_KEY',
        ]));
    });

    test('does not make development or tests require production secrets', () => {
        expect(validateProductionConfig({ NODE_ENV: 'test' })).toMatchObject({ valid: true });
    });
});
