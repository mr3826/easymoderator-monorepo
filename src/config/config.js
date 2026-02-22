require('dotenv').config({ override: true });

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

if (env === 'production') {
    [
        'DATABASE_URL',
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
        'SESSION_SECRET',
        'CORS_ORIGINS',
        'FRONTEND_URL',
        'META_WEBHOOK_APP_SECRET',
        'PAYMENT_ENCRYPTION_KEY'
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
    bodySizeLimit: process.env.BODY_SIZE_LIMIT || '1mb',
    allowSelfSignedTls: process.env.ALLOW_SELF_SIGNED_TLS === 'true',
    corsOrigins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
        : [],
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1d',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    sessionSecret: process.env.SESSION_SECRET,
    workflowUrl: process.env.WF1_WEBHOOK_URL || '',
    metaWebhookAppSecret: process.env.META_WEBHOOK_APP_SECRET,
    internalWebhookSecret: process.env.INTERNAL_WEBHOOK_SECRET || '',
    // Cookie config for httpOnly token storage
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    // Account lockout
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5,
    loginLockoutMinutes: parseInt(process.env.LOGIN_LOCKOUT_MINUTES, 10) || 15,
    // Payment callback security (P0-4)
    paymentGatewayIpAllowlist: process.env.PAYMENT_GATEWAY_IP_ALLOWLIST
        ? process.env.PAYMENT_GATEWAY_IP_ALLOWLIST.split(',').map(ip => ip.trim()).filter(Boolean)
        : [],
    paymentCallbackHmacSecret: process.env.PAYMENT_CALLBACK_HMAC_SECRET || ''
};
