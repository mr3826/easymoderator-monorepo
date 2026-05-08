/**
 * One-time migration script: push .env.production secrets into AWS Secrets Manager.
 *
 * Usage:
 *   AWS_PROFILE=your-profile node scripts/push-secrets-to-aws.js
 *
 * Requirements:
 *   - AWS credentials with secretsmanager:CreateSecret / PutSecretValue permissions
 *   - .env.production file present in the backend root
 *
 * After running this successfully:
 *   1. Verify the secret in AWS Console (Secrets Manager > easymod/production)
 *   2. Attach the easymod-secrets-reader IAM role to your EC2 instance
 *   3. Delete .env.production and .env.local locally
 *   4. Run: git rm --cached .env.production .env.local .env.staging
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const {
    SecretsManagerClient,
    CreateSecretCommand,
    PutSecretValueCommand,
    DescribeSecretCommand,
} = require('@aws-sdk/client-secrets-manager');

const ENV_FILE = path.join(__dirname, '..', '.env.production');
const SECRET_NAME = process.env.AWS_SECRET_NAME || 'easymod/production';
const REGION = process.env.AWS_REGION || 'ap-south-1';

async function pushSecrets() {
    if (!fs.existsSync(ENV_FILE)) {
        console.error(`ERROR: .env.production not found at ${ENV_FILE}`);
        console.error('Make sure you run this script from the EasyMod-backend directory.');
        process.exit(1);
    }

    const parsed = dotenv.parse(fs.readFileSync(ENV_FILE, 'utf-8'));
    const keyCount = Object.keys(parsed).length;

    if (keyCount === 0) {
        console.error('ERROR: .env.production is empty or could not be parsed.');
        process.exit(1);
    }

    console.log(`Read ${keyCount} variables from .env.production`);
    console.log(`Target secret: ${SECRET_NAME} (region: ${REGION})\n`);

    const client = new SecretsManagerClient({ region: REGION });

    let secretExists = false;
    try {
        await client.send(new DescribeSecretCommand({ SecretId: SECRET_NAME }));
        secretExists = true;
    } catch (err) {
        if (err.name !== 'ResourceNotFoundException') {
            throw err;
        }
    }

    const secretString = JSON.stringify(parsed, null, 2);

    if (secretExists) {
        await client.send(
            new PutSecretValueCommand({
                SecretId: SECRET_NAME,
                SecretString: secretString,
            })
        );
        console.log(`Updated existing secret: ${SECRET_NAME}`);
    } else {
        await client.send(
            new CreateSecretCommand({
                Name: SECRET_NAME,
                SecretString: secretString,
                Description: 'EasyMod production environment secrets — managed by secrets-loader.js',
            })
        );
        console.log(`Created new secret: ${SECRET_NAME}`);
    }

    console.log(`\nDone! ${keyCount} secrets are now in AWS Secrets Manager.`);
    console.log('\nNext steps:');
    console.log('  1. Verify in AWS Console → Secrets Manager → easymod/production');
    console.log('  2. Ensure your EC2 instance has an IAM role with this policy:');
    console.log('     { "Effect": "Allow", "Action": ["secretsmanager:GetSecretValue"],');
    console.log(`       "Resource": "arn:aws:secretsmanager:${REGION}:*:secret:${SECRET_NAME}*" }`);
    console.log('  3. Delete .env.production and .env.local locally (do NOT commit them)');
    console.log('  4. Run: git rm --cached .env.production .env.local .env.staging');
    console.log('  5. Commit: git commit -m "chore: stop tracking env files"');
}

pushSecrets().catch((err) => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
