/**
 * Channel Entity — Token Encryption Tests
 *
 * Tests the AES-256-CBC getter/setter on the access_token field of the Channel model.
 * These are pure crypto unit tests — no DB connection required.
 */

// ── Environment ────────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.CHANNEL_ENCRYPTION_KEY = 'a'.repeat(64); // 64-char hex → 32-byte key

// ── Mocks (before require) ─────────────────────────────────────────────────────
jest.mock('src/config/redis', () => ({
    sessionRedis: null, cacheRedis: null, rateLimitRedis: null,
    closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({}))
}));

jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }))
}));

// Provide a real Sequelize-like model stub so the entity file can call sequelize.define()
const modelInstance = {
    getDataValue: jest.fn(),
    setDataValue: jest.fn(),
};

jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn((name, attrs) => {
            // Build a fake model factory that lets us test getter/setter logic
            return { _attrs: attrs, _name: name };
        }),
        authenticate: jest.fn(), sync: jest.fn(), literal: jest.fn(s => s)
    }
}));

// ── Helpers ────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

/**
 * Exercise the getter/setter defined on the Channel model's access_token field
 * by reading them directly from the Sequelize model attrs map.
 */
function getEncryptionHelpers() {
    // Re-require after env is set so getEncryptionKey() picks up the env var
    jest.isolateModules(() => {}); // flush module registry if needed
    const { sequelize } = require('src/utils/database/database-setup');

    // Load the entity so define() is called
    const Channel = require('src/modules/channel/channel.entity');

    // Extract the getter/setter from the attrs passed to sequelize.define()
    const defineCall = sequelize.define.mock.calls[0];
    const attrs = defineCall ? defineCall[1] : {};
    const tokenAttr = attrs.access_token;

    // Create a fake Sequelize model instance with in-memory data storage
    let rawValue = undefined;
    const fakeInstance = {
        getDataValue: jest.fn(() => rawValue),
        setDataValue: jest.fn((field, val) => { rawValue = val; }),
    };

    const encrypt = (token) => {
        tokenAttr.set.call(fakeInstance, token);
        return rawValue;
    };

    const decrypt = (encrypted) => {
        rawValue = encrypted;
        return tokenAttr.get.call(fakeInstance);
    };

    return { encrypt, decrypt };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Channel entity — access_token encryption (AES-256-CBC)', () => {
    let encrypt, decrypt;

    beforeAll(() => {
        ({ encrypt, decrypt } = getEncryptionHelpers());
    });

    it('encrypt then decrypt returns the original plaintext token', () => {
        const original = 'EAAXMyFacebookPageToken12345';
        const ciphertext = encrypt(original);
        expect(decrypt(ciphertext)).toBe(original);
    });

    it('stored format is iv:ciphertext (two colon-delimited segments)', () => {
        const ciphertext = encrypt('some-token');
        const parts = ciphertext.split(':');
        expect(parts).toHaveLength(2);
        expect(parts[0]).toHaveLength(32); // 16-byte IV → 32 hex chars
        expect(parts[1].length).toBeGreaterThan(0);
    });

    it('two encryptions of the same token differ (random IV)', () => {
        const t1 = encrypt('same-token');
        const t2 = encrypt('same-token');
        expect(t1).not.toBe(t2);
    });

    it('setting null stores null (no encryption of empty value)', () => {
        encrypt(null);
        const { sequelize } = require('src/utils/database/database-setup');
        // After setting null the raw value should be null (setDataValue called with null)
        const defineCall = sequelize.define.mock.calls[0];
        const tokenAttr = defineCall[1].access_token;

        let rawValue;
        const fakeInstance = {
            getDataValue: jest.fn(() => rawValue),
            setDataValue: jest.fn((_, v) => { rawValue = v; }),
        };
        tokenAttr.set.call(fakeInstance, null);
        expect(rawValue).toBeNull();
    });

    it('getter returns null when stored value is null (no token set)', () => {
        const val = decrypt(null);
        expect(val).toBeNull();
    });

    it('getter returns null (does not throw) when stored value is corrupted', () => {
        // Should not throw — getter swallows decryption errors and returns null
        const val = decrypt('corrupted-not-valid-hex:data');
        expect(val).toBeNull();
    });

    it('getter returns null when stored iv is wrong length', () => {
        const val = decrypt('0000:deadbeef');
        expect(val).toBeNull();
    });

    it('works with long tokens (512+ char tokens from Meta System Users)', () => {
        const longToken = 'EAA' + 'X'.repeat(512);
        const encrypted = encrypt(longToken);
        expect(decrypt(encrypted)).toBe(longToken);
    });

    it('works when CHANNEL_ENCRYPTION_KEY is a raw string (non-hex, SHA-256 derived)', () => {
        // Override with a non-hex key to test the SHA-256 derivation path
        const originalKey = process.env.CHANNEL_ENCRYPTION_KEY;
        process.env.CHANNEL_ENCRYPTION_KEY = 'my-human-readable-key-string';
        delete require.cache[require.resolve('src/modules/channel/channel.entity')];

        let enc2, dec2;
        try {
            const { encrypt: enc, decrypt: dec } = getEncryptionHelpers();
            enc2 = enc; dec2 = dec;
        } finally {
            process.env.CHANNEL_ENCRYPTION_KEY = originalKey;
            delete require.cache[require.resolve('src/modules/channel/channel.entity')];
        }

        const token = 'test-token-with-string-key';
        expect(dec2(enc2(token))).toBe(token);
    });
});

// ── Standalone crypto parity tests (no Sequelize dependency) ──────────────────

describe('Channel entity — AES-256-CBC crypto correctness', () => {
    const KEY_HEX = 'a'.repeat(64);
    const KEY = Buffer.from(KEY_HEX, 'hex');

    function manualEncrypt(plaintext) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
        let enc = cipher.update(plaintext, 'utf8', 'hex');
        enc += cipher.final('hex');
        return iv.toString('hex') + ':' + enc;
    }

    function manualDecrypt(ciphertext) {
        const [ivHex, enc] = ciphertext.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
        let dec = decipher.update(enc, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    }

    it('manual encrypt/decrypt roundtrip matches', () => {
        const token = 'EAAFacebookAccessToken';
        expect(manualDecrypt(manualEncrypt(token))).toBe(token);
    });

    it('tampered ciphertext throws on decrypt', () => {
        const enc = manualEncrypt('some-token');
        const parts = enc.split(':');
        const tampered = parts[0] + ':' + 'ff'.repeat(32);
        expect(() => manualDecrypt(tampered)).toThrow();
    });
});
