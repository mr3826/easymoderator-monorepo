/**
 * GCP Secret Manager Loader
 *
 * In production (NODE_ENV=production):
 *   Fetches each secret from GCP Secret Manager in parallel.
 *   Secret names follow the pattern: ${GCP_SECRET_PREFIX}${KEY}
 *   (e.g. "easymod-DATABASE_URL" → process.env.DATABASE_URL)
 *
 *   The Cloud Run service account must have:
 *     roles/secretmanager.secretAccessor
 *
 *   No JSON key file is needed — uses Application Default Credentials (ADC).
 *
 * In development / staging (NODE_ENV != production):
 *   No-op. Dotenv / .env files handle secrets locally.
 */

const env = process.env.NODE_ENV || 'development';
let loaded = false;

// All secret keys to load from GCP Secret Manager
const SECRET_KEYS = [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'JWT_ACCESS_EXPIRES_IN',
    'JWT_REFRESH_EXPIRES_IN',
    'SESSION_SECRET',
    'PAYMENT_ENCRYPTION_KEY',
    'CHANNEL_ENCRYPTION_KEY',
    'DELIVERY_ENCRYPTION_KEY',
    'META_WEBHOOK_APP_SECRET',
    'META_WEBHOOK_VERIFY_TOKEN',
    'META_APP_ID',
    'META_APP_SECRET',
    'META_OAUTH_REDIRECT_URI',
    'CORS_ORIGINS',
    'FRONTEND_URL',
    'BASE_URL',
    'COOKIE_DOMAIN',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'ADMIN_EMAIL',
    'SENTRY_DSN',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'PINECONE_API_KEY',
    'PINECONE_INDEX',
    'PINECONE_NAMESPACE',
];

async function loadSecrets() {
    if (loaded) return;

    if (env !== 'production') {
        loaded = true;
        return;
    }

    const projectId = process.env.GCP_PROJECT_ID;
    if (!projectId) {
        // No GCP project — secrets loaded from .env.prod (DO deployment)
        loaded = true;
        return;
    }

    const prefix = process.env.GCP_SECRET_PREFIX || 'easymod-';

    let SecretManagerServiceClient;
    try {
        ({ SecretManagerServiceClient } = require('@google-cloud/secret-manager'));
    } catch (e) {
        process.stderr.write(
            'FATAL: @google-cloud/secret-manager is not installed. Run: npm install @google-cloud/secret-manager\n'
        );
        process.exit(1);
    }

    const client = new SecretManagerServiceClient();

    // Fetch all secrets in parallel
    const results = await Promise.allSettled(
        SECRET_KEYS.map(async (key) => {
            const secretName = `projects/${projectId}/secrets/${prefix}${key}/versions/latest`;
            const [version] = await client.accessSecretVersion({ name: secretName });
            const value = version.payload?.data?.toString('utf-8') || '';
            return { key, value };
        })
    );

    let loadedCount = 0;
    const failed = [];

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const { key, value } = result.value;
            // Only set if not already overridden by environment
            if (value && !process.env[key]) {
                process.env[key] = value;
                loadedCount++;
            }
        } else {
            const msg = result.reason?.message || String(result.reason);
            failed.push(msg);
        }
    }

    if (failed.length > 0) {
        process.stderr.write(
            `[secrets-loader] WARNING: Failed to load ${failed.length} secret(s) from GCP Secret Manager. ` +
            `config.js will throw for any required ones that are missing.\n`
        );
    }

    loaded = true;
    process.stdout.write(
        `[secrets-loader] Loaded ${loadedCount} secrets from GCP Secret Manager (project: ${projectId})\n`
    );
}

module.exports = loadSecrets;
