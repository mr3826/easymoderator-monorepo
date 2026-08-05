// Do NOT use override:true — if NODE_ENV (or other vars) are already set in the
// process environment (e.g. by test runners or CI), they should take precedence
// over the .env file.
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
const { assertProductionConfig } = require('./production-config.validator');

assertProductionConfig(process.env);

module.exports = {
    port: process.env.PORT || 3000,
    env,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    redisPassword: process.env.REDIS_PASSWORD || '',
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: process.env.REDIS_PORT || 6379,
    redisSessionDb: process.env.REDIS_SESSION_DB || '0',
    redisCacheDb: process.env.REDIS_CACHE_DB || '1',
    redisRateLimitDb: process.env.REDIS_RATELIMIT_DB || '2',
    bodySizeLimit: process.env.BODY_SIZE_LIMIT || '35mb',
    allowSelfSignedTls: process.env.ALLOW_SELF_SIGNED_TLS === 'true',
    growthOsEnabled: process.env.GROWTH_OS_ENABLED === 'true',
    corsOrigins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
        : [],
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtResetSecret: process.env.JWT_RESET_SECRET || process.env.JWT_ACCESS_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1d',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    sessionSecret: process.env.SESSION_SECRET,
    csrfSecret: process.env.CSRF_SECRET || process.env.SESSION_SECRET,
    // Meta signs webhook POST bodies and signed_request payloads with the app secret.
    // Keep this alias for older call sites/tests, but do not require a second secret.
    metaWebhookAppSecret: process.env.META_APP_SECRET,
    // Global verify token used by Meta App Dashboard when configuring the webhook
    // subscription (the single GET /webhooks/meta?hub.challenge handshake at
    // dashboard-config time). Per-channel webhook_verify_token rows in
    // meta_channels are unrelated — they were a Phase-1 artefact and don't match
    // what the App Dashboard sends. Without this fallback, App Review fails the
    // webhook setup step.
    metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
    metaAppId: process.env.META_APP_ID,
    metaAppSecret: process.env.META_APP_SECRET,
    metaOAuthRedirectUri: process.env.META_OAUTH_REDIRECT_URI
        || (process.env.FRONTEND_URL && `${process.env.FRONTEND_URL}/app/channels/oauth-callback`),
    // Cookie config for httpOnly token storage
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    // Account lockout
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5,
    loginLockoutMinutes: parseInt(process.env.LOGIN_LOCKOUT_MINUTES, 10) || 15,
    // Payment callback security (P0-4)
    paymentGatewayIpAllowlist: process.env.PAYMENT_GATEWAY_IP_ALLOWLIST
        ? process.env.PAYMENT_GATEWAY_IP_ALLOWLIST.split(',').map(ip => ip.trim()).filter(Boolean)
        : [],
    paymentCallbackHmacSecret: process.env.PAYMENT_CALLBACK_HMAC_SECRET || '',
    channelEncryptionKey: process.env.CHANNEL_ENCRYPTION_KEY,

};
