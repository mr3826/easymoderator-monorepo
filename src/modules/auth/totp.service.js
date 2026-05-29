/**
 * TOTP (Time-based One-Time Password) Service — RFC 6238
 *
 * Implements TOTP using only Node.js built-in `crypto` (no external library).
 * Secrets are stored AES-256-GCM encrypted in user.settings.totp_secret.
 *
 * Key is derived from APP_SECRET (falls back to JWT_SECRET).
 */

const crypto = require('crypto');
const { User } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { getRedisClient } = require('../../utils/redis-client');

// ── Encryption helpers ──────────────────────────────────────────────────────

const getEncryptionKey = () => {
    const secret = process.env.APP_SECRET || process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
    if (!secret) {
        throw new Error('APP_SECRET, JWT_SECRET, or JWT_ACCESS_SECRET environment variable is required for TOTP encryption');
    }
    // scrypt: memory-hard KDF — resistant to brute-force if secret is ever leaked
    return crypto.scryptSync(secret, 'easymod-totp-key-v1', 32);
};

const encryptSecret = (plaintext) => {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
};

const decryptSecret = (ciphertext) => {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
};

// ── HOTP / TOTP core ───────────────────────────────────────────────────────

/**
 * Compute HOTP (RFC 4226) for the given base32 secret and counter.
 * @param {string} base32Secret
 * @param {number} counter
 * @returns {string} 6-digit OTP
 */
const hotp = (base32Secret, counter) => {
    // Decode base32
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of base32Secret.toUpperCase().replace(/=+$/, '')) {
        const val = alphabet.indexOf(ch);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    const keyBytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        keyBytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    const keyBuf = Buffer.from(keyBytes);

    // Counter as 8-byte big-endian
    const counterBuf = Buffer.alloc(8);
    // JavaScript numbers are safe up to 2^53 — fine for TOTP counters
    let c = counter;
    for (let i = 7; i >= 0; i--) {
        counterBuf[i] = c & 0xff;
        c = Math.floor(c / 256);
    }

    const hmac = crypto.createHmac('sha1', keyBuf).update(counterBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    return String(code % 1000000).padStart(6, '0');
};

/**
 * Compute TOTP (RFC 6238) — verify ±1 window for clock skew.
 * @param {string} base32Secret
 * @param {string} token - 6-digit string from authenticator app
 * @returns {boolean}
 */
const verifyTotp = (base32Secret, token) => {
    const step = 30; // 30-second window
    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / step);
    // Allow ±1 step (±30 s) for clock skew
    for (const delta of [-1, 0, 1]) {
        if (hotp(base32Secret, counter + delta) === token) {
            return true;
        }
    }
    return false;
};

// ── Redis used-token store to prevent replay attacks ───────────────────────

const TOTP_USED_PREFIX = 'totp_used:';

const markTokenUsed = async (userId, token) => {
    const redis = getRedisClient();
    if (!redis) return;
    // Mark as used for 90 seconds (3 × 30 s window)
    await redis.setex(`${TOTP_USED_PREFIX}${userId}:${token}`, 90, '1');
};

const isTokenUsed = async (userId, token) => {
    const redis = getRedisClient();
    if (!redis) return false;
    const result = await redis.get(`${TOTP_USED_PREFIX}${userId}:${token}`);
    return result === '1';
};

// ── Temp tokens for 2FA login step ────────────────────────────────────────

const TOTP_TEMP_PREFIX = 'totp_temp:';

const saveTempToken = async (userId, tempToken) => {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.setex(`${TOTP_TEMP_PREFIX}${tempToken}`, 300, userId); // 5 min TTL
};

const consumeTempToken = async (tempToken) => {
    const redis = getRedisClient();
    if (!redis) return null;
    const userId = await redis.get(`${TOTP_TEMP_PREFIX}${tempToken}`);
    if (userId) await redis.del(`${TOTP_TEMP_PREFIX}${tempToken}`);
    return userId;
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a new TOTP secret for a user.
 * Saves the encrypted secret to user.settings.totp_pending (not yet enabled).
 * @param {string} userId
 * @returns {{ secret: string, qrUrl: string }}
 */
const generateTotpSecret = async (userId) => {
    const user = await User.findByPk(userId);
    if (!user) throw new AppError('User not found', 404);

    // Generate 20-byte random secret, encode as base32
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const rawBytes = crypto.randomBytes(20);
    let base32 = '';
    let buffer = 0;
    let bitsLeft = 0;
    for (const byte of rawBytes) {
        buffer = (buffer << 8) | byte;
        bitsLeft += 8;
        while (bitsLeft >= 5) {
            bitsLeft -= 5;
            base32 += alphabet[(buffer >> bitsLeft) & 0x1f];
        }
    }
    // Pad to multiple of 8
    while (base32.length % 8 !== 0) base32 += '=';

    const issuer = 'EasyMod';
    const label = encodeURIComponent(`${issuer}:${user.email}`);
    const qrUrl = `otpauth://totp/${label}?secret=${base32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    // Store encrypted pending secret (not active until first verify)
    const settings = user.settings || {};
    await user.update({
        settings: {
            ...settings,
            totp_pending: encryptSecret(base32)
        }
    });

    return { secret: base32, qrUrl };
};

/**
 * Verify the token and activate 2FA.
 * @param {string} userId
 * @param {string} token - 6-digit code from authenticator
 */
const enableTotp = async (userId, token) => {
    const user = await User.findByPk(userId);
    if (!user) throw new AppError('User not found', 404);

    const settings = user.settings || {};
    if (!settings.totp_pending) throw new AppError('No TOTP setup in progress. Call /2fa/setup first.', 400);

    const secret = decryptSecret(settings.totp_pending);
    if (!verifyTotp(secret, token)) throw new AppError('Invalid TOTP token', 400);

    await user.update({
        settings: {
            ...settings,
            totp_secret: settings.totp_pending,
            totp_pending: null,
            totp_enabled: true
        },
        refresh_token: null
    });

    return { enabled: true };
};

/**
 * Verify a TOTP token (used during login step 2).
 * @param {string} userId
 * @param {string} token
 * @returns {boolean}
 */
const verifyTotpToken = async (userId, token) => {
    const user = await User.findByPk(userId);
    if (!user) throw new AppError('User not found', 404);

    const settings = user.settings || {};
    if (!settings.totp_enabled || !settings.totp_secret) {
        throw new AppError('2FA is not enabled for this account', 400);
    }

    if (await isTokenUsed(userId, token)) {
        throw new AppError('TOTP token already used. Please wait for the next code.', 400);
    }

    const secret = decryptSecret(settings.totp_secret);
    if (!verifyTotp(secret, token)) throw new AppError('Invalid TOTP token', 400);

    await markTokenUsed(userId, token);
    return true;
};

/**
 * Disable 2FA after verifying the current token.
 * @param {string} userId
 * @param {string} token
 */
const disableTotp = async (userId, token) => {
    const user = await User.findByPk(userId);
    if (!user) throw new AppError('User not found', 404);

    const settings = user.settings || {};
    if (!settings.totp_enabled || !settings.totp_secret) {
        throw new AppError('2FA is not currently enabled', 400);
    }

    const secret = decryptSecret(settings.totp_secret);
    if (!verifyTotp(secret, token)) throw new AppError('Invalid TOTP token', 400);

    await user.update({
        settings: {
            ...settings,
            totp_secret: null,
            totp_pending: null,
            totp_enabled: false
        }
    });

    return { disabled: true };
};

module.exports = {
    generateTotpSecret,
    enableTotp,
    verifyTotpToken,
    disableTotp,
    saveTempToken,
    consumeTempToken
};
