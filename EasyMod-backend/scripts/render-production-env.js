'use strict';

const fs = require('fs');
const path = require('path');
const { assertProductionConfig } = require('../src/config/production-config.validator');

const outputPath = path.resolve(process.argv[2] || '.env.prod');
const source = process.env;
const renderInputRequired = ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'COOKIE_DOMAIN'];

const missingRenderInputs = renderInputRequired.filter((name) => !source[name]);
if (missingRenderInputs.length) {
    throw new Error(
        `Missing deployment environment variables: ${missingRenderInputs.sort().join(', ')}`,
    );
}

function required(name) {
    return source[name] || '';
}

function encode(value) {
    return JSON.stringify(String(value ?? ''));
}

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
    PAYMENT_ENCRYPTION_KEY: required('PAYMENT_ENCRYPTION_KEY'),
    DELIVERY_ENCRYPTION_KEY: required('DELIVERY_ENCRYPTION_KEY'),
    CHANNEL_ENCRYPTION_KEY: required('CHANNEL_ENCRYPTION_KEY'),
    PAYMENT_CALLBACK_HMAC_SECRET: required('PAYMENT_CALLBACK_HMAC_SECRET'),
    CORS_ORIGINS: required('CORS_ORIGINS'),
    FRONTEND_URL: required('FRONTEND_URL'),
    BASE_URL: required('BASE_URL'),
    PUBLIC_BASE_URL: source.PUBLIC_BASE_URL || required('BASE_URL'),
    COOKIE_DOMAIN: required('COOKIE_DOMAIN'),
    META_OAUTH_REDIRECT_URI: required('META_OAUTH_REDIRECT_URI'),
    META_APP_ID: required('META_APP_ID'),
    META_APP_SECRET: required('META_APP_SECRET'),
    META_WEBHOOK_VERIFY_TOKEN: required('META_WEBHOOK_VERIFY_TOKEN'),
    BKASH_ENABLED: source.BKASH_ENABLED || 'true',
    BKASH_BASE_URL: required('BKASH_BASE_URL'),
    BKASH_USERNAME: required('BKASH_USERNAME'),
    BKASH_PASSWORD: required('BKASH_PASSWORD'),
    BKASH_APP_KEY: required('BKASH_APP_KEY'),
    BKASH_APP_SECRET: required('BKASH_APP_SECRET'),
    BKASH_WEBHOOK_SECRET: required('BKASH_WEBHOOK_SECRET'),
    BKASH_SANDBOX: source.BKASH_SANDBOX || 'false',
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

assertProductionConfig(rendered);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
    outputPath,
    `${Object.entries(rendered).map(([name, value]) => `${name}=${encode(value)}`).join('\n')}\n`,
    { mode: 0o600 },
);
console.log(`Production environment preflight passed (${Object.keys(rendered).length} variables rendered).`);
