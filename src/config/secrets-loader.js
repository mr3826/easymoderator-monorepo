/**
 * AWS Secrets Manager loader.
 *
 * In production: fetches the JSON secret at `easymod/production` from AWS Secrets
 * Manager and merges all key/value pairs into process.env BEFORE config.js is loaded.
 *
 * In development/staging: no-op — dotenv handles secrets via .env files.
 *
 * The EC2 instance must have an IAM role with:
 *   secretsmanager:GetSecretValue on arn:aws:secretsmanager:ap-south-1:*:secret:easymod/production*
 * No AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY needed — the SDK uses instance metadata.
 */

const env = process.env.NODE_ENV || 'development';

let loaded = false;

async function loadSecrets() {
    if (loaded) return;

    if (env !== 'production') {
        loaded = true;
        return;
    }

    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

    const secretName = process.env.AWS_SECRET_NAME || 'easymod/production';
    const region = process.env.AWS_REGION || 'ap-south-1';

    const client = new SecretsManagerClient({ region });

    let secrets;
    try {
        const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
        secrets = JSON.parse(response.SecretString);
    } catch (err) {
        process.stderr.write(
            `FATAL: Could not load secrets from AWS Secrets Manager (${secretName}): ${err.message}\n`
        );
        process.exit(1);
    }

    const keys = Object.keys(secrets);
    keys.forEach((key) => {
        // Only set if not already set — lets AWS_* overrides work via EC2 user-data if needed
        if (!process.env[key]) {
            process.env[key] = String(secrets[key]);
        }
    });

    loaded = true;
    process.stdout.write(`[secrets-loader] Loaded ${keys.length} secrets from AWS Secrets Manager (${secretName})\n`);
}

module.exports = loadSecrets;
