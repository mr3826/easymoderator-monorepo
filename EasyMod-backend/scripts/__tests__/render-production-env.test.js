'use strict';

/**
 * Deployment render + preflight matrix (findings F-01, provider config, §10).
 *
 * Exercises the pure builder rather than the CLI so no file is written and no
 * value is printed. Proves:
 *   - PAYMENT_ENCRYPTION_KEY legacy/hex/missing handling preserves the runtime
 *     AES key and never emits the raw value.
 *   - bKash credentials are required only when enabled, and never rendered when
 *     disabled.
 *   - Core secrets, alert sink, empty and placeholder values all fail closed.
 */

const crypto = require('crypto');
const { buildRenderedEnv, normalizePaymentEncryptionKey } = require('../render-production-env');

const hex64 = (letter) => letter.repeat(64);

/** A raw GitHub-secret-style source env that renders to a valid production config. */
function validSource(overrides = {}) {
    return {
        // render inputs
        DB_USER: 'easymod_user',
        DB_PASSWORD: 'a-strong-db-password',
        DB_NAME: 'easymod',
        COOKIE_DOMAIN: 'easymod.tech',
        // core secrets
        JWT_ACCESS_SECRET: hex64('a'),
        JWT_REFRESH_SECRET: hex64('b'),
        SESSION_SECRET: hex64('c'),
        CSRF_SECRET: hex64('d'),
        PAYMENT_ENCRYPTION_KEY: 'legacy-non-hex-payment-key-value',
        DELIVERY_ENCRYPTION_KEY: hex64('2'),
        CHANNEL_ENCRYPTION_KEY: hex64('3'),
        PAYMENT_CALLBACK_HMAC_SECRET: hex64('g'),
        CORS_ORIGINS: 'https://easymod.tech',
        FRONTEND_URL: 'https://easymod.tech',
        BASE_URL: 'https://easymod.tech',
        META_OAUTH_REDIRECT_URI: 'https://easymod.tech/app/channels/oauth-callback',
        META_APP_ID: '1234567890',
        META_APP_SECRET: hex64('e'),
        META_WEBHOOK_VERIFY_TOKEN: hex64('f'),
        RESEND_API_KEY: 're_live_key',
        EMAIL_FROM: 'EasyModerator <no-reply@easymod.tech>',
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        OPENAI_API_KEY: 'sk-openai-test',
        // keep optional providers off so the fixture stays minimal
        BKASH_ENABLED: 'false',
        TELEGRAM_ENABLED: 'false',
        ...overrides,
    };
}

describe('PAYMENT_ENCRYPTION_KEY normalization (F-01)', () => {
    test('a legacy non-hex value renders as its sha256 digest — the runtime AES key is preserved', () => {
        const raw = 'legacy-non-hex-payment-key-value';
        const rendered = buildRenderedEnv(validSource({ PAYMENT_ENCRYPTION_KEY: raw }));

        const expected = crypto.createHash('sha256').update(raw).digest('hex');
        expect(rendered.PAYMENT_ENCRYPTION_KEY).toBe(expected);
        expect(rendered.PAYMENT_ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/);
    });

    test('the raw legacy value never appears in the rendered output', () => {
        const raw = 'legacy-non-hex-payment-key-value';
        const rendered = buildRenderedEnv(validSource({ PAYMENT_ENCRYPTION_KEY: raw }));
        expect(JSON.stringify(rendered)).not.toContain(raw);
    });

    test('an already-64-hex value passes through unchanged (no double hashing)', () => {
        const hex = hex64('1');
        const rendered = buildRenderedEnv(validSource({ PAYMENT_ENCRYPTION_KEY: hex }));
        expect(rendered.PAYMENT_ENCRYPTION_KEY).toBe(hex);
    });

    test('the normalized digest matches the runtime key derivation exactly', () => {
        // Mirror src/modules/payment/payment-config.entity.js#getEncryptionKey.
        const raw = 'some other legacy value';
        const runtimeKey = /^[a-f0-9]{64}$/i.test(raw)
            ? Buffer.from(raw, 'hex')
            : crypto.createHash('sha256').update(raw).digest();
        const normalized = normalizePaymentEncryptionKey(raw, {});
        expect(Buffer.from(normalized, 'hex').equals(runtimeKey)).toBe(true);
    });

    test('a missing payment key fails the preflight', () => {
        expect(() => buildRenderedEnv(validSource({ PAYMENT_ENCRYPTION_KEY: '' })))
            .toThrow(/PAYMENT_ENCRYPTION_KEY/);
    });
});

describe('bKash provider posture (§6)', () => {
    test('disabled with no bKash secrets renders a valid config', () => {
        const rendered = buildRenderedEnv(validSource({ BKASH_ENABLED: 'false' }));
        expect(rendered.BKASH_ENABLED).toBe('false');
    });

    test('disabled never renders any merchant credential', () => {
        const rendered = buildRenderedEnv(validSource({
            BKASH_ENABLED: 'false',
            BKASH_APP_KEY: 'should-not-be-rendered',
            BKASH_APP_SECRET: 'should-not-be-rendered',
        }));
        expect(rendered).not.toHaveProperty('BKASH_APP_KEY');
        expect(rendered).not.toHaveProperty('BKASH_APP_SECRET');
        expect(rendered).not.toHaveProperty('BKASH_WEBHOOK_SECRET');
        expect(JSON.stringify(rendered)).not.toContain('should-not-be-rendered');
    });

    test('enabled with a missing credential fails the preflight', () => {
        expect(() => buildRenderedEnv(validSource({
            BKASH_ENABLED: 'true',
            BKASH_BASE_URL: 'https://tokenized.pay.bka.sh',
            BKASH_USERNAME: 'user',
            BKASH_PASSWORD: 'pass',
            // BKASH_APP_KEY missing
            BKASH_APP_SECRET: 'secret',
            BKASH_WEBHOOK_SECRET: hex64('h'),
            BKASH_SANDBOX: 'false',
        }))).toThrow(/BKASH_APP_KEY/);
    });

    test('enabled with the full set and live sandbox renders a valid config', () => {
        const rendered = buildRenderedEnv(validSource({
            BKASH_ENABLED: 'true',
            BKASH_BASE_URL: 'https://tokenized.pay.bka.sh',
            BKASH_USERNAME: 'user',
            BKASH_PASSWORD: 'pass',
            BKASH_APP_KEY: 'app-key',
            BKASH_APP_SECRET: 'app-secret',
            BKASH_WEBHOOK_SECRET: hex64('h'),
            BKASH_SANDBOX: 'false',
        }));
        expect(rendered.BKASH_ENABLED).toBe('true');
        expect(rendered.BKASH_APP_KEY).toBe('app-key');
    });
});

describe('core secret / alert sink fail-closed (§10)', () => {
    test('missing CSRF_SECRET fails', () => {
        expect(() => buildRenderedEnv(validSource({ CSRF_SECRET: '' }))).toThrow(/CSRF_SECRET/);
    });

    test('no backend alert sink (neither Sentry nor Slack) fails', () => {
        expect(() => buildRenderedEnv(validSource({ SENTRY_DSN: '', SLACK_ALERT_WEBHOOK_URL: '' })))
            .toThrow(/SENTRY_DSN\|SLACK_ALERT_WEBHOOK_URL/);
    });

    test('Slack-only alert sink is accepted', () => {
        const rendered = buildRenderedEnv(validSource({
            SENTRY_DSN: '',
            SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x',
        }));
        expect(rendered.SLACK_ALERT_WEBHOOK_URL).toContain('hooks.slack.com');
    });

    test('an empty required secret fails', () => {
        expect(() => buildRenderedEnv(validSource({ JWT_ACCESS_SECRET: '' }))).toThrow(/JWT_ACCESS_SECRET/);
    });

    test('a placeholder secret value fails', () => {
        expect(() => buildRenderedEnv(validSource({ SESSION_SECRET: 'change_in_production_please_00000' })))
            .toThrow(/SESSION_SECRET/);
    });

    test('a missing render input fails before any secret work', () => {
        expect(() => buildRenderedEnv(validSource({ COOKIE_DOMAIN: '' })))
            .toThrow(/Missing deployment environment variables: COOKIE_DOMAIN/);
    });
});

// This file is a strict allowlist: a variable absent from it cannot be set in
// production by any repo secret, no matter what the code default says. A kill
// switch that silently cannot be thrown is worse than no kill switch.
describe('image-understanding switches are settable in production', () => {
    test('both render with their intended defaults when unset', () => {
        const env = buildRenderedEnv(validSource());
        expect(env.AI_PHOTO_MATCH_ENABLED).toBe('true');   // customer photos: on
        expect(env.AI_VISION_ENABLED).toBe('false');       // merchant images: off
    });

    test('AI_PHOTO_MATCH_ENABLED=false actually reaches .env.prod', () => {
        const env = buildRenderedEnv(validSource({ AI_PHOTO_MATCH_ENABLED: 'false' }));
        expect(env.AI_PHOTO_MATCH_ENABLED).toBe('false');
    });

    test('vision can be turned on deliberately', () => {
        const env = buildRenderedEnv(validSource({ AI_VISION_ENABLED: 'true' }));
        expect(env.AI_VISION_ENABLED).toBe('true');
    });
});
