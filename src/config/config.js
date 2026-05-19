// Do NOT use override:true — if NODE_ENV (or other vars) are already set in the
// process environment (e.g. by test runners or CI), they should take precedence
// over the .env file.
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

const requireEnv = (key) => {
    if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return process.env[key];
};

const isWeakSecret = (value) => {
    if (!value) return true;
    const lower = value.toLowerCase();
    const blocked = new Set([
        'change-me',
        'your-access-secret-key-change-in-production',
        'your-refresh-secret-key-change-in-production',
        'your-session-secret-change-in-production',
        'your-32-byte-payment-encryption-key',
        'prod-access-secret-change-me',
        'prod-refresh-secret-change-me',
        'prod-session-secret-change-me',
        'prod-payment-encryption-key-change-me',
        'staging-access-secret-change-me',
        'staging-refresh-secret-change-me',
        'staging-session-secret-change-me',
        'staging-payment-encryption-key-change-me'
    ]);

    if (blocked.has(lower)) return true;
    if (lower.includes('change-me')) return true;
    if (lower.includes('your-') && lower.includes('secret')) return true;
    return value.length < 16;
};

if (['production', 'staging'].includes(env)) {
    [
        'DATABASE_URL',
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
        'SESSION_SECRET',
        'CORS_ORIGINS',
        'FRONTEND_URL',
        'META_WEBHOOK_APP_SECRET',
        'PAYMENT_ENCRYPTION_KEY',
        'CHANNEL_ENCRYPTION_KEY',  // required: encrypts Meta System User tokens at rest
        'META_APP_ID',             // required: Meta OAuth app ID
        'META_APP_SECRET'          // required: Meta OAuth app secret
    ].forEach(requireEnv);
}

if (['production', 'staging'].includes(env)) {
    const secrets = {
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
        SESSION_SECRET: process.env.SESSION_SECRET,
        PAYMENT_ENCRYPTION_KEY: process.env.PAYMENT_ENCRYPTION_KEY
    };

    Object.entries(secrets).forEach(([key, value]) => {
        if (isWeakSecret(value)) {
            throw new Error(`Weak or placeholder secret detected: ${key}`);
        }
    });
}

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
    bodySizeLimit: process.env.BODY_SIZE_LIMIT || '1mb',
    allowSelfSignedTls: process.env.ALLOW_SELF_SIGNED_TLS === 'true',
    corsOrigins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
        : [],
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtResetSecret: process.env.JWT_RESET_SECRET || process.env.JWT_ACCESS_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1d',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    sessionSecret: process.env.SESSION_SECRET,
    metaWebhookAppSecret: process.env.META_WEBHOOK_APP_SECRET,
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

    // ── Meta Integration Redesign — Dual-Write Feature Flags ────────────────
    // Phase 1: reads still use legacy meta_integrations table.
    // Phase 3: flip META_READ_FROM_NEW=true to cut reads over to meta_channels.
    // Phase 5: remove both flags once legacy tables are dropped.
    //
    // META_READ_FROM_NEW: when true, MetaChannelService.find* reads from meta_channels
    //   Default: false (safe during Phase 1 — dual-write only, reads from legacy)
    metaReadFromNew: process.env.META_READ_FROM_NEW === 'true',

    // META_WRITE_LEGACY: when true, writes also propagate to meta_integrations/channel_configs
    //   Default: true (ensures legacy paths continue working during transition)
    metaWriteLegacy: process.env.META_WRITE_LEGACY !== 'false'
};
