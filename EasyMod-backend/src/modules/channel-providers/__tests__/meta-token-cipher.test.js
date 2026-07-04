/**
 * meta-token-cipher — Unit Tests (TDD: written before implementation)
 *
 * Covers:
 *  - encrypt/decrypt round-trip
 *  - version prefix format (v2:iv:authTag:ct)
 *  - legacy format read (iv:authTag:ct treated as v2)
 *  - tamper detection (GCM auth tag invalidation)
 *  - null/empty input handling
 *  - two encryptions of same plaintext produce different ciphertext (random IV)
 *  - VERSION export
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.CHANNEL_ENCRYPTION_KEY = 'a'.repeat(64); // 64-char hex -> 32-byte key

const cipher = require('src/utils/meta-token-cipher');

describe('meta-token-cipher — VERSION export', () => {
    it('exports VERSION string equal to v2', () => {
        expect(typeof cipher.VERSION).toBe('string');
        expect(cipher.VERSION).toBe('v2');
    });

    it('exports encrypt and decrypt functions', () => {
        expect(typeof cipher.encrypt).toBe('function');
        expect(typeof cipher.decrypt).toBe('function');
    });
});

describe('meta-token-cipher — encrypt()', () => {
    it('returns a string with v2: prefix', () => {
        const ct = cipher.encrypt('EAAMyToken');
        expect(ct).toMatch(/^v2:/);
    });

    it('returns format v2:iv:authTag:ct — exactly 4 colon-delimited segments', () => {
        const ct = cipher.encrypt('EAAMyToken');
        const parts = ct.split(':');
        expect(parts).toHaveLength(4);
        expect(parts[0]).toBe('v2');
        expect(parts[1]).toHaveLength(32); // 16-byte IV = 32 hex chars
        expect(parts[2]).toHaveLength(32); // 16-byte auth tag = 32 hex chars
        expect(parts[3].length).toBeGreaterThan(0);
    });

    it('two encryptions of the same plaintext are different (random IV)', () => {
        const ct1 = cipher.encrypt('same-token');
        const ct2 = cipher.encrypt('same-token');
        expect(ct1).not.toBe(ct2);
    });

    it('throws if plaintext is null', () => {
        expect(() => cipher.encrypt(null)).toThrow();
    });

    it('throws if plaintext is empty string', () => {
        expect(() => cipher.encrypt('')).toThrow();
    });

    it('handles a long token (512+ chars like Meta System User tokens)', () => {
        const longToken = 'EAA' + 'B'.repeat(512);
        const ct = cipher.encrypt(longToken);
        expect(ct).toMatch(/^v2:/);
    });
});

describe('meta-token-cipher — decrypt() with v2 format', () => {
    it('round-trip: decrypt(encrypt(x)) === x', () => {
        const original = 'EAAFacebookLongLivedToken_XYZ987654321';
        const ct = cipher.encrypt(original);
        expect(cipher.decrypt(ct)).toBe(original);
    });

    it('handles a long token (512+ chars)', () => {
        const longToken = 'EAA' + 'B'.repeat(512);
        expect(cipher.decrypt(cipher.encrypt(longToken))).toBe(longToken);
    });

    it('handles tokens with URL-safe special characters', () => {
        const token = 'EAAB+test/token=padding==_hyphen-underscore';
        expect(cipher.decrypt(cipher.encrypt(token))).toBe(token);
    });
});

describe('meta-token-cipher — legacy format read (iv:authTag:ct, no v2 prefix)', () => {
    const crypto = require('crypto');

    function legacyEncrypt(plaintext, keyHex) {
        const key = Buffer.from(keyHex, 'hex');
        const iv = crypto.randomBytes(16);
        const aad = Buffer.from('meta-token');
        const c = crypto.createCipheriv('aes-256-gcm', key, iv);
        c.setAAD(aad);
        let enc = c.update(plaintext, 'utf8', 'hex');
        enc += c.final('hex');
        const authTag = c.getAuthTag();
        // Legacy format: iv:authTag:ct (no v2: prefix)
        return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + enc;
    }

    it('decrypts a legacy-format ciphertext (3 segments, no v2: prefix)', () => {
        const keyHex = 'a'.repeat(64);
        const legacyCt = legacyEncrypt('legacy-access-token', keyHex);
        expect(legacyCt.startsWith('v2:')).toBe(false);
        expect(legacyCt.split(':').length).toBe(3);
        expect(cipher.decrypt(legacyCt)).toBe('legacy-access-token');
    });
});

describe('meta-token-cipher — legacy scrypt fallback (integration/meta.service.js compat)', () => {
    const crypto = require('crypto');

    /**
     * Reproduces the exact encryption used by integration/meta.service.js#encryptToken —
     * scrypt-derived key, 3-segment format, no version prefix. The new cipher must
     * be able to read these so backfilled rows from meta_integrations stay readable
     * during the dual-write window.
     */
    function scryptLegacyEncrypt(plaintext) {
        const key = crypto.scryptSync(process.env.CHANNEL_ENCRYPTION_KEY, 'salt', 32);
        const iv = crypto.randomBytes(16);
        const c = crypto.createCipheriv('aes-256-gcm', key, iv);
        c.setAAD(Buffer.from('meta-token'));
        let enc = c.update(plaintext, 'utf8', 'hex');
        enc += c.final('hex');
        const authTag = c.getAuthTag();
        return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + enc;
    }

    it('decrypts a scrypt-encrypted legacy ciphertext', () => {
        const original = 'EAA_legacy_scrypt_token';
        const ct = scryptLegacyEncrypt(original);
        expect(ct.split(':').length).toBe(3);
        expect(cipher.decrypt(ct)).toBe(original);
    });

    it('still decrypts the primary-key legacy format (no false-positive scrypt match)', () => {
        // Primary-key 3-segment ciphertext should still round-trip via primary key
        const key = Buffer.from(process.env.CHANNEL_ENCRYPTION_KEY, 'hex');
        const iv = crypto.randomBytes(16);
        const c = crypto.createCipheriv('aes-256-gcm', key, iv);
        c.setAAD(Buffer.from('meta-token'));
        let enc = c.update('primary-key-legacy', 'utf8', 'hex');
        enc += c.final('hex');
        const primaryLegacy =
            iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc;
        expect(cipher.decrypt(primaryLegacy)).toBe('primary-key-legacy');
    });

    it('round-trips v2 ciphertexts unaffected by the legacy fallback', () => {
        const ct = cipher.encrypt('still-works');
        expect(cipher.decrypt(ct)).toBe('still-works');
    });
});

describe('meta-token-cipher — tamper detection', () => {
    it('throws if the auth tag is tampered', () => {
        const ct = cipher.encrypt('sensitive-token');
        const parts = ct.split(':'); // [v2, iv, authTag, ciphertext]
        const lastByte = parts[2].slice(-2);
        const replacementByte = lastByte === 'ff' ? '00' : 'ff';
        const tamperedAuthTag = parts[2].slice(0, -2) + replacementByte;
        const tampered = [parts[0], parts[1], tamperedAuthTag, parts[3]].join(':');
        expect(() => cipher.decrypt(tampered)).toThrow();
    });

    it('throws if the ciphertext bytes are tampered', () => {
        const ct = cipher.encrypt('sensitive-token');
        const parts = ct.split(':');
        const tamperedCt = 'ff'.repeat(Math.floor(parts[3].length / 2));
        const tampered = [parts[0], parts[1], parts[2], tamperedCt].join(':');
        expect(() => cipher.decrypt(tampered)).toThrow();
    });

    it('throws if the IV is tampered', () => {
        const ct = cipher.encrypt('sensitive-token');
        const parts = ct.split(':');
        const tampered = [parts[0], 'ff'.repeat(16), parts[2], parts[3]].join(':');
        expect(() => cipher.decrypt(tampered)).toThrow();
    });

    it('throws on completely invalid ciphertext string', () => {
        expect(() => cipher.decrypt('not-a-valid-ciphertext')).toThrow();
    });

    it('throws on empty string input', () => {
        expect(() => cipher.decrypt('')).toThrow();
    });

    it('throws on null input', () => {
        expect(() => cipher.decrypt(null)).toThrow();
    });
});
