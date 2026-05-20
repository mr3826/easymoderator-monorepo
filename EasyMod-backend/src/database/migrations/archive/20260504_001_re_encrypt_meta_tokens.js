'use strict';

const crypto = require('crypto');

/**
 * Migration: Re-encrypt meta_integrations.access_token
 *
 * The token was previously encrypted with jwtAccessSecret as the key source.
 * This migration re-encrypts all existing tokens using CHANNEL_ENCRYPTION_KEY
 * so that JWT secret rotation no longer invalidates stored channel tokens.
 *
 * Strategy: idempotent — try to decrypt with the new key first.
 * If that succeeds, the row is already migrated; skip it.
 * If it fails (auth tag mismatch), decrypt with the old key and re-encrypt with the new key.
 *
 * Both CHANNEL_ENCRYPTION_KEY and JWT_ACCESS_SECRET must be present
 * in the environment when this migration runs.
 */

const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('meta-token');

function deriveKey(secret) {
    return crypto.scryptSync(secret, 'salt', 32);
}

function tryDecrypt(encryptedToken, key) {
    const parts = encryptedToken.split(':');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function encryptToken(plaintext, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(AAD);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

module.exports = {
    name: '20260504_001_re_encrypt_meta_tokens',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') return;

        const channelKey = process.env.CHANNEL_ENCRYPTION_KEY;
        const jwtSecret = process.env.JWT_ACCESS_SECRET;

        if (!channelKey) throw new Error('CHANNEL_ENCRYPTION_KEY is required for this migration');
        if (!jwtSecret) throw new Error('JWT_ACCESS_SECRET is required for this migration');

        const newKey = deriveKey(channelKey);
        const oldKey = deriveKey(jwtSecret);

        const [rows] = await sequelize.query(
            `SELECT id, access_token FROM meta_integrations WHERE access_token IS NOT NULL`
        );

        let migrated = 0;
        let skipped = 0;
        let failed = 0;

        for (const row of rows) {
            const { id, access_token } = row;
            if (!access_token) { skipped++; continue; }

            // Test if already encrypted with the new key
            try {
                tryDecrypt(access_token, newKey);
                skipped++; // Already migrated
                continue;
            } catch (_alreadyNew) {
                // Expected for rows not yet migrated
            }

            // Decrypt with old key, re-encrypt with new key
            try {
                const plaintext = tryDecrypt(access_token, oldKey);
                const reEncrypted = encryptToken(plaintext, newKey);
                await sequelize.query(
                    `UPDATE meta_integrations SET access_token = :token WHERE id = :id`,
                    { replacements: { token: reEncrypted, id } }
                );
                migrated++;
            } catch (err) {
                console.error(`[migration] Failed to re-encrypt token for integration ${id}: ${err.message}`);
                failed++;
            }
        }

        console.log(`[migration] Token re-encryption complete: ${migrated} migrated, ${skipped} skipped (already new key), ${failed} failed`);
        if (failed > 0) {
            throw new Error(`${failed} token(s) could not be re-encrypted — check logs and fix before proceeding`);
        }
    },

    down: async () => {
        // Re-encryption is a one-way migration.
        // To reverse: run the same logic swapping newKey and oldKey.
        // Not implemented here to avoid accidental key downgrade in production.
        console.warn('[migration] down() for token re-encryption is a no-op — reverse manually if needed');
    }
};
