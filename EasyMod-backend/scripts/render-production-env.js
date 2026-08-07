'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertProductionConfig } = require('../src/config/production-config.validator');

const RENDER_INPUT_REQUIRED = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];

function encode(value) {
    return JSON.stringify(String(value ?? ''));
}

function enabledFlag(value) {
    return String(value || '').toLowerCase() === 'true';
}

/**
 * Register a derived secret with the Actions log scrubber. The transformed key
 * is not itself a GitHub secret, so without this it would not be masked if it
 * ever leaked into a stack trace. No-op outside Actions so a local render never
 * writes a control command to a terminal.
 */
function maskInActions(value, source) {
    if (value && source.GITHUB_ACTIONS === 'true') {
        process.stdout.write(`::add-mask::${value}\n`);
    }
}

/**
 * PAYMENT_ENCRYPTION_KEY compatibility (finding F-01).
 *
 * The runtime derives its AES key as:
 *     /^[a-f0-9]{64}$/i.test(v) ? Buffer.from(v,'hex') : sha256(v)
 * (src/modules/payment/payment-config.entity.js). The production secret is not
 * 64 hex characters, so the effective key today is sha256(secret).
 *
 * The preflight requires 64 hex. Setting a NEW random hex key would satisfy the
 * preflight and silently change the derived key — AES-256-CBC has no auth tag,
 * so every stored merchant credential would decrypt to garbage rather than
 * error. Instead we compute the SAME digest the runtime already computes and
 * write that. The bytes are identical; nothing re-encrypts; the GitHub secret
 * is never modified.
 *
 * A value that is already 64 hex passes through untouched.
 *
 * Follow-up (not this change): a real rotation needs a decrypt-old /
 * re-encrypt-new migration onto AES-256-GCM. Tracked in
 * docs/launch-readiness/2026-07-26-remediation/04_PAYMENT_KEY_COMPATIBILITY.md.
 */
function normalizePaymentEncryptionKey(raw, source = process.env) {
    const value = String(raw ?? '');
    if (!value) return '';
    if (/^[a-f0-9]{64}$/i.test(value)) return value;
    const normalized = crypto.createHash('sha256').update(value).digest('hex');
    maskInActions(normalized, source);
    return normalized;
}

/**
 * Build the full rendered production environment object from a source env.
 * Pure apart from the Actions mask side-effect; never touches the filesystem.
 * Throws if a render input or the production config validator is unsatisfied.
 */
function buildRenderedEnv(source = process.env) {
    const required = (name) => source[name] || '';
    const marketingUrl = required('MARKETING_URL');
    const appUrl = required('APP_URL') || required('FRONTEND_URL');
    const apiUrl = required('API_URL') || required('BASE_URL');
    const publicAssetUrl = required('PUBLIC_ASSET_URL') || source.PUBLIC_BASE_URL || apiUrl;

    const missingRenderInputs = RENDER_INPUT_REQUIRED.filter((name) => !source[name]);
    if (missingRenderInputs.length) {
        throw new Error(
            `Missing deployment environment variables: ${missingRenderInputs.sort().join(', ')}`,
        );
    }

    // Provider credentials are only rendered when their provider is on. A
    // disabled gateway must not put merchant credentials into .env.prod at all.
    const bkashSection = enabledFlag(source.BKASH_ENABLED)
        ? {
            BKASH_ENABLED: 'true',
            BKASH_BASE_URL: required('BKASH_BASE_URL'),
            BKASH_USERNAME: required('BKASH_USERNAME'),
            BKASH_PASSWORD: required('BKASH_PASSWORD'),
            BKASH_APP_KEY: required('BKASH_APP_KEY'),
            BKASH_APP_SECRET: required('BKASH_APP_SECRET'),
            BKASH_WEBHOOK_SECRET: required('BKASH_WEBHOOK_SECRET'),
            BKASH_SANDBOX: source.BKASH_SANDBOX || 'false',
        }
        : { BKASH_ENABLED: 'false' };

    const rendered = {
        NODE_ENV: 'production',
        PORT: source.PORT || '3000',
        LOG_LEVEL: source.LOG_LEVEL || 'info',
        DATABASE_URL: `postgresql://${encodeURIComponent(required('DB_USER'))}:${encodeURIComponent(required('DB_PASSWORD'))}@postgres:5432/${encodeURIComponent(required('DB_NAME'))}`,
        DB_USER: required('DB_USER'),
        DB_PASSWORD: required('DB_PASSWORD'),
        DB_NAME: required('DB_NAME'),
        POSTGRES_USER: required('DB_USER'),
        POSTGRES_PASSWORD: required('DB_PASSWORD'),
        POSTGRES_DB: required('DB_NAME'),
        REDIS_URL: source.REDIS_URL || 'redis://redis:6379',
        REDIS_HOST: 'redis',
        REDIS_PORT: '6379',
        DB_SSL: source.DB_SSL || 'false',
        JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
        JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
        JWT_ACCESS_EXPIRES_IN: source.JWT_ACCESS_EXPIRES_IN || '1d',
        JWT_REFRESH_EXPIRES_IN: source.JWT_REFRESH_EXPIRES_IN || '30d',
        SESSION_SECRET: required('SESSION_SECRET'),
        CSRF_SECRET: required('CSRF_SECRET'),
        PAYMENT_ENCRYPTION_KEY: normalizePaymentEncryptionKey(source.PAYMENT_ENCRYPTION_KEY, source),
        DELIVERY_ENCRYPTION_KEY: required('DELIVERY_ENCRYPTION_KEY'),
        CHANNEL_ENCRYPTION_KEY: required('CHANNEL_ENCRYPTION_KEY'),
        PAYMENT_CALLBACK_HMAC_SECRET: required('PAYMENT_CALLBACK_HMAC_SECRET'),
        MARKETING_URL: marketingUrl,
        APP_URL: appUrl,
        API_URL: apiUrl,
        PUBLIC_ASSET_URL: publicAssetUrl,
        CORS_ORIGINS: required('CORS_ORIGINS'),
        FRONTEND_URL: appUrl,
        BASE_URL: apiUrl,
        PUBLIC_BASE_URL: publicAssetUrl,
        ...(source.COOKIE_DOMAIN ? { COOKIE_DOMAIN: source.COOKIE_DOMAIN } : {}),
        ...(source.LEGACY_COOKIE_DOMAIN ? { LEGACY_COOKIE_DOMAIN: source.LEGACY_COOKIE_DOMAIN } : {}),
        META_OAUTH_REDIRECT_URI: required('META_OAUTH_REDIRECT_URI'),
        META_APP_ID: required('META_APP_ID'),
        META_APP_SECRET: required('META_APP_SECRET'),
        META_WEBHOOK_VERIFY_TOKEN: required('META_WEBHOOK_VERIFY_TOKEN'),
        ...bkashSection,
        PATHAO_CLIENT_ID: source.PATHAO_CLIENT_ID || '',
        PATHAO_CLIENT_SECRET: source.PATHAO_CLIENT_SECRET || '',
        STEADFAST_API_KEY: source.STEADFAST_API_KEY || '',
        STEADFAST_SECRET_KEY: source.STEADFAST_SECRET_KEY || '',
        TELEGRAM_ENABLED: source.TELEGRAM_ENABLED || 'true',
        TELEGRAM_BOT_TOKEN: required('TELEGRAM_BOT_TOKEN'),
        TELEGRAM_BOT_USERNAME: required('TELEGRAM_BOT_USERNAME'),
        TELEGRAM_WEBHOOK_SECRET: required('TELEGRAM_WEBHOOK_SECRET'),
        OPENAI_API_KEY: source.OPENAI_API_KEY || '',
        GEMINI_API_KEY: source.GEMINI_API_KEY || '',
        GOOGLE_GEMINI_API_KEY: source.GEMINI_API_KEY || '',
        // Image understanding. Rendered explicitly rather than left to the code
        // defaults so both are actually SETTABLE in production — this file is a
        // strict allowlist, and a flag absent from it cannot be changed by any
        // repo secret. AI_PHOTO_MATCH_ENABLED=false is the kill switch for the
        // customer-photo path (2 Gemini calls per photo message against a
        // 15 req/min free-tier cap); AI_VISION_ENABLED stays off.
        AI_PHOTO_MATCH_ENABLED: source.AI_PHOTO_MATCH_ENABLED || 'true',
        AI_VISION_ENABLED: source.AI_VISION_ENABLED || 'false',
        EMBEDDING_PROVIDER: source.EMBEDDING_PROVIDER || '',
        EMBEDDING_MODEL: source.EMBEDDING_MODEL || '',
        GEMINI_EMBEDDING_MODEL: source.GEMINI_EMBEDDING_MODEL || '',
        QDRANT_URL: source.QDRANT_URL || 'http://qdrant:6333',
        QDRANT_API_KEY: source.QDRANT_API_KEY || '',
        QDRANT_COLLECTION: source.QDRANT_COLLECTION || '',
        SENTRY_DSN: source.SENTRY_DSN || '',
        SLACK_ALERT_WEBHOOK_URL: source.SLACK_ALERT_WEBHOOK_URL || '',
        RESEND_API_KEY: required('RESEND_API_KEY'),
        EMAIL_FROM: required('EMAIL_FROM'),
        SEED_ADMIN_EMAIL: source.SEED_ADMIN_EMAIL || 'admin@easymod.tech',
        SEED_ADMIN_PASSWORD: source.SEED_ADMIN_PASSWORD || '',
        SEED_ADMIN_NAME: source.SEED_ADMIN_NAME || 'EasyMod Admin',
        SEED_ADMIN_PHONE: source.SEED_ADMIN_PHONE || '01700000000',
        SEED_ADMIN_SHOP: source.SEED_ADMIN_SHOP || 'EasyModerator Review Shop',
        SEED_ADMIN_PLATFORM_ROLE: 'SUPER_ADMIN',
        SEED_ADMIN_PAID_MONTHS: '12',
        ALLOW_SELF_SIGNED_TLS: source.ALLOW_SELF_SIGNED_TLS || 'false',
        BODY_SIZE_LIMIT: source.BODY_SIZE_LIMIT || '35mb',
        MEDIA_FETCH_ALLOWED_HOSTS: source.MEDIA_FETCH_ALLOWED_HOSTS || '',
        START_EMBEDDED_WORKERS: 'false',
        RUN_MIGRATIONS_ON_STARTUP: 'false',
        MAX_LOGIN_ATTEMPTS: '5',
        LOGIN_LOCKOUT_MINUTES: '15',
    };

    // Fail before writing anything if the config is unsafe.
    assertProductionConfig(rendered);
    return rendered;
}

function renderToFile(outputPath, source = process.env) {
    const rendered = buildRenderedEnv(source);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
        outputPath,
        `${Object.entries(rendered).map(([name, value]) => `${name}=${encode(value)}`).join('\n')}\n`,
        { mode: 0o600 },
    );
    return rendered;
}

module.exports = {
    buildRenderedEnv,
    normalizePaymentEncryptionKey,
    renderToFile,
    RENDER_INPUT_REQUIRED,
};

// CLI entry point — only runs when invoked directly, so tests can import the
// pure functions without triggering a file write or a process-wide throw.
if (require.main === module) {
    const outputPath = path.resolve(process.argv[2] || '.env.prod');
    const rendered = renderToFile(outputPath, process.env);
    // Never print the values — count only.
    console.log(`Production environment preflight passed (${Object.keys(rendered).length} variables rendered).`);
}
