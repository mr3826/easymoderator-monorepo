'use strict';

/**
 * webhook-payload-cipher.js
 *
 * AES-256-GCM encrypt/decrypt for the retry payload stored on a durable Meta
 * webhook receipt.
 *
 * A receipt has to be replayable: when message storage fails, or when the Page
 * is not yet mapped to a connected channel, the reconciler needs the original
 * event body to re-run ingestion. That body contains the buyer's message text
 * and PSID, so it is never written to the database in the clear.
 *
 * Format:  v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Key derivation matches meta-token-cipher.js (CHANNEL_ENCRYPTION_KEY, raw when
 * 64-hex, SHA-256 of the string otherwise) so operators have one key to manage,
 * but the AAD differs so a token ciphertext can never be replayed as a payload
 * ciphertext or vice versa.
 */

const crypto = require('crypto');

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('meta-webhook-payload');

let _cachedKey = null;
let _cachedKeyEnv = null;

function getKey() {
    const raw = process.env.CHANNEL_ENCRYPTION_KEY;
    if (!raw) throw new Error('CHANNEL_ENCRYPTION_KEY is not set');
    if (_cachedKey && raw === _cachedKeyEnv) return _cachedKey;
    _cachedKey = /^[a-f0-9]{64}$/i.test(raw)
        ? Buffer.from(raw, 'hex')
        : crypto.createHash('sha256').update(raw).digest();
    _cachedKeyEnv = raw;
    return _cachedKey;
}

/**
 * @param {object} value JSON-serialisable event body.
 * @returns {string} "v1:iv:authTag:ct"
 */
function encryptPayload(value) {
    const plaintext = JSON.stringify(value ?? null);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    cipher.setAAD(AAD);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return [VERSION, iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted].join(':');
}

/**
 * @param {string} ciphertext
 * @returns {object|null} the original value
 * @throws on tampering, wrong key, or malformed input
 */
function decryptPayload(ciphertext) {
    if (typeof ciphertext !== 'string' || !ciphertext) {
        throw new Error('webhook-payload-cipher: ciphertext must be a non-empty string');
    }
    const parts = ciphertext.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error('webhook-payload-cipher: unrecognised ciphertext format');
    }
    const [, ivHex, authTagHex, encryptedHex] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let plaintext = decipher.update(encryptedHex, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return JSON.parse(plaintext);
}

module.exports = { encryptPayload, decryptPayload, VERSION };
