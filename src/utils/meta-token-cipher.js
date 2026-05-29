/**
 * meta-token-cipher.js
 *
 * Versioned AES-256-GCM encrypt/decrypt utility for Meta access tokens.
 *
 * Format:  v2:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Backwards-compatible read support for the legacy 3-segment format produced
 * by the 20260504_001_re_encrypt_meta_tokens migration:
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>   (treated as v2 on decrypt)
 *
 * Key derivation: reads CHANNEL_ENCRYPTION_KEY from env.
 *   - If it is a 64-char hex string: used as raw 32-byte key (Buffer.from(key,'hex'))
 *   - Otherwise: SHA-256 hash of the raw string is used as the key
 *
 * Both paths match the key derivation already in channel.entity.js to ensure
 * tokens encrypted by the legacy entity can still be read by this utility.
 *
 * AAD: Buffer.from('meta-token') — matches the migration's AAD for legacy compat.
 *
 * Exports: { encrypt(plaintext), decrypt(ciphertext), VERSION }
 */

'use strict';

const crypto = require('crypto');

const VERSION = 'v2';
const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('meta-token');

// Cache derived keys — scrypt is intentionally expensive.
let _cachedPrimaryKey = null;
let _cachedScryptKey = null;
let _cachedKeyEnv = null;

function _resetCacheIfEnvChanged() {
    if (process.env.CHANNEL_ENCRYPTION_KEY !== _cachedKeyEnv) {
        _cachedPrimaryKey = null;
        _cachedScryptKey = null;
        _cachedKeyEnv = process.env.CHANNEL_ENCRYPTION_KEY;
    }
}

/**
 * Primary key derivation — used for all new encryption and as the first
 * decryption attempt. Matches channel.entity.js so tokens written by the
 * legacy entity (CBC ciphertexts excluded) remain readable.
 *   - 64-char hex env: raw 32-byte key
 *   - otherwise:       SHA-256 of the env string
 */
function getKey() {
    _resetCacheIfEnvChanged();
    if (_cachedPrimaryKey) return _cachedPrimaryKey;
    const raw = process.env.CHANNEL_ENCRYPTION_KEY;
    if (!raw) throw new Error('CHANNEL_ENCRYPTION_KEY is not set');
    _cachedPrimaryKey = /^[a-f0-9]{64}$/i.test(raw)
        ? Buffer.from(raw, 'hex')
        : crypto.createHash('sha256').update(raw).digest();
    return _cachedPrimaryKey;
}

/**
 * Legacy scrypt-derived key — matches integration/meta.service.js#encryptToken
 * (`crypto.scryptSync(CHANNEL_ENCRYPTION_KEY, 'salt', 32)`). Tried as a
 * fallback when decrypting legacy 3-segment ciphertexts.
 *
 * Phase 2 re-encryption migration converts all stored tokens to v2 format
 * encrypted with the primary key — this fallback becomes unreachable after
 * that migration, but stays in place to absorb any tokens written by the
 * legacy code path during the dual-write window.
 */
function getLegacyScryptKey() {
    _resetCacheIfEnvChanged();
    if (_cachedScryptKey) return _cachedScryptKey;
    const raw = process.env.CHANNEL_ENCRYPTION_KEY;
    if (!raw) throw new Error('CHANNEL_ENCRYPTION_KEY is not set');
    _cachedScryptKey = crypto.scryptSync(raw, 'salt', 32);
    return _cachedScryptKey;
}

function _tryDecryptWithKey(key, ivHex, authTagHex, encryptedHex) {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(encryptedHex, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
}

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext - The access token to encrypt. Must be non-empty.
 * @returns {string} Ciphertext in format "v2:iv:authTag:ct"
 */
function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) {
        throw new Error('meta-token-cipher: plaintext must not be null or undefined');
    }
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('meta-token-cipher: plaintext must be a non-empty string');
    }

    const key = getKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(AAD);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return VERSION + ':' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a ciphertext string.
 *
 * Accepts two formats:
 *   v2:<iv>:<authTag>:<ct>    — current versioned format
 *   <iv>:<authTag>:<ct>       — legacy format (3 segments, treated as v2)
 *
 * @param {string} ciphertext
 * @returns {string} Decrypted plaintext
 * @throws {Error} On any decryption failure (including auth tag mismatch / tampering)
 */
function decrypt(ciphertext) {
    if (ciphertext === null || ciphertext === undefined) {
        throw new Error('meta-token-cipher: ciphertext must not be null or undefined');
    }
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
        throw new Error('meta-token-cipher: ciphertext must be a non-empty string');
    }

    const parts = ciphertext.split(':');
    let ivHex, authTagHex, encryptedHex;

    if (parts.length === 4 && parts[0] === VERSION) {
        // v2:iv:authTag:ct
        [, ivHex, authTagHex, encryptedHex] = parts;
    } else if (parts.length === 3) {
        // Legacy format: iv:authTag:ct (no version prefix)
        [ivHex, authTagHex, encryptedHex] = parts;
    } else {
        throw new Error(
            'meta-token-cipher: unrecognised ciphertext format — expected v2:iv:authTag:ct or iv:authTag:ct'
        );
    }

    // Try the primary key first.
    try {
        return _tryDecryptWithKey(getKey(), ivHex, authTagHex, encryptedHex);
    } catch (primaryErr) {
        // Legacy fallback: tokens written by integration/meta.service.js use a
        // scrypt-derived key. The 3-segment format has no version marker, so
        // we can't tell which key was used without trying.
        if (parts.length === 3) {
            try {
                return _tryDecryptWithKey(getLegacyScryptKey(), ivHex, authTagHex, encryptedHex);
            } catch (_legacyErr) {
                // fall through to primary error
            }
        }
        throw primaryErr;
    }
}

module.exports = { encrypt, decrypt, VERSION };
