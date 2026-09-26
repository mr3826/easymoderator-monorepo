/**
 * TOTP Service Tests
 * Tests for 2FA/TOTP functionality including the security fixes
 */

const crypto = require('crypto');

// Set env vars before loading modules
process.env.NODE_ENV = 'test';
process.env.APP_SECRET = 'test-app-secret-32-chars-long!!';
process.env.JWT_SECRET = 'test-jwt-secret-32-chars-long!!';

// Mock Redis
const redisStore = {};
const mockRedis = {
    get: jest.fn((key) => Promise.resolve(redisStore[key] || null)),
    setex: jest.fn((key, ttl, val) => { redisStore[key] = val; return Promise.resolve('OK'); }),
    del: jest.fn((key) => { delete redisStore[key]; return Promise.resolve(1); }),
    // Real Redis executes SET ... NX and GETDEL atomically; the mock does the
    // same by resolving each synchronously at call time.
    set: jest.fn((key, val, ...args) => {
        if (args.includes('NX') && key in redisStore) return Promise.resolve(null);
        redisStore[key] = val;
        return Promise.resolve('OK');
    }),
    getdel: jest.fn((key) => {
        const value = key in redisStore ? redisStore[key] : null;
        delete redisStore[key];
        return Promise.resolve(value);
    }),
    status: 'ready'
};

const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockInvalidateUserSessions = jest.fn().mockResolvedValue(2);

jest.mock('src/utils/redis-client', () => ({
    getRedisClient: () => mockRedis
}));

jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (callback) => callback(mockTransaction)),
    },
}));

jest.mock('src/modules/auth/session-invalidation.service', () => ({
    invalidateUserSessions: mockInvalidateUserSessions,
}));

// Mock User entity
const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    settings: {},
    update: jest.fn(function(data) {
        this.settings = { ...this.settings, ...data.settings };
        return Promise.resolve();
    })
};

jest.mock('src/modules/entities', () => ({
    User: {
        findByPk: jest.fn(() => Promise.resolve(mockUser))
    }
}));

const { User } = require('src/modules/entities');
const totpService = require('src/modules/auth/totp.service');

const decodeBase32 = (base32Secret) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const character of base32Secret.toUpperCase().replace(/=+$/, '')) {
        const value = alphabet.indexOf(character);
        if (value >= 0) bits += value.toString(2).padStart(5, '0');
    }

    const bytes = [];
    for (let index = 0; index + 8 <= bits.length; index += 8) {
        bytes.push(parseInt(bits.slice(index, index + 8), 2));
    }
    return Buffer.from(bytes);
};

const currentTotpToken = (base32Secret, now = Date.now()) => {
    const counter = Math.floor(now / 1000 / 30);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac('sha1', decodeBase32(base32Secret))
        .update(counterBuffer)
        .digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const code = ((digest[offset] & 0x7f) << 24)
        | ((digest[offset + 1] & 0xff) << 16)
        | ((digest[offset + 2] & 0xff) << 8)
        | (digest[offset + 3] & 0xff);
    return String(code % 1000000).padStart(6, '0');
};

const enableTestTotp = async (userId = 'user-1') => {
    const { secret } = await totpService.generateTotpSecret(userId);
    const encryptedSecret = mockUser.settings.totp_pending;
    mockUser.settings = {
        ...mockUser.settings,
        totp_pending: null,
        totp_secret: encryptedSecret,
        totp_enabled: true
    };
    return secret;
};

describe('TOTP Service Security', () => {
    beforeEach(() => {
        Object.keys(redisStore).forEach(k => delete redisStore[k]);
        jest.clearAllMocks();
        mockUser.settings = {};
    });

    describe('Encryption Key', () => {
        it('should throw error when every encryption secret is missing', async () => {
            // JWT_ACCESS_SECRET is a third accepted source (totp.service.js:18).
            // Leaving it set meant the module resolved a key and did not throw.
            const saved = {
                APP_SECRET: process.env.APP_SECRET,
                JWT_SECRET: process.env.JWT_SECRET,
                JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
            };
            delete process.env.APP_SECRET;
            delete process.env.JWT_SECRET;
            delete process.env.JWT_ACCESS_SECRET;

            try {
                // getEncryptionKey() is called lazily, at first use — importing
                // the module never touched it, so the old `expect(require(...))`
                // could not have thrown no matter which secrets were unset.
                jest.resetModules();
                const service = require('src/modules/auth/totp.service');
                await expect(service.generateTotpSecret('user-1'))
                    .rejects.toThrow(/required for TOTP encryption/);
            } finally {
                // Restore in a finally: a bare assignment after the assertion is
                // skipped when it fails, and every later test in this file then
                // dies on the missing secret instead of reporting its own result.
                Object.entries(saved).forEach(([k, v]) => {
                    if (v === undefined) delete process.env[k];
                    else process.env[k] = v;
                });
                jest.resetModules();
            }
        });
    });

    describe('TOTP Token Replay Protection', () => {
        it('should mark TOTP token as used after successful verification', async () => {
            const userId = 'user-1';
            // enableTestTotp drives the service's own setup path, so totp_secret
            // holds the encrypted iv:tag:ciphertext form rather than a raw base32
            // string that decryptSecret would split into an undefined tag.
            const secret = await enableTestTotp(userId);
            const token = currentTotpToken(secret);

            await totpService.verifyTotpToken(userId, token);

            // The code is recorded as used, so presenting it again is refused.
            expect(redisStore[`totp_used:${userId}:${token}`]).toBe('1');
            await expect(totpService.verifyTotpToken(userId, token))
                .rejects
                .toThrow('already used');
        });

        it('accepts a code exactly once when two verifications race', async () => {
            const userId = 'user-1';
            const secret = await enableTestTotp(userId);
            const token = currentTotpToken(secret);

            const results = await Promise.allSettled([
                totpService.verifyTotpToken(userId, token),
                totpService.verifyTotpToken(userId, token),
            ]);

            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            const rejected = results.filter((r) => r.status === 'rejected');
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason.message).toMatch(/already used/);
        });

        it('should reject reused TOTP tokens', async () => {
            const userId = 'user-1';
            const secret = await enableTestTotp(userId);
            const token = currentTotpToken(secret);

            // Mark token as already used
            redisStore[`totp_used:${userId}:${token}`] = '1';

            // Try to verify again - should throw
            await expect(totpService.verifyTotpToken(userId, token))
                .rejects
                .toThrow('already used');
        });
    });

    describe('TOTP Secret Encryption', () => {
        it('should encrypt TOTP secret when enabling 2FA', async () => {
            const userId = 'user-1';

            // Generate secret
            await totpService.generateTotpSecret(userId);

            // Check that settings were updated with encrypted pending secret
            const updateCall = mockUser.update.mock.calls[0];
            expect(updateCall[0].settings).toHaveProperty('totp_pending');

            // The pending secret should be encrypted (contains IV:TAG:ENCRYPTED format)
            const encryptedSecret = updateCall[0].settings.totp_pending;
            expect(encryptedSecret).toMatch(/^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/);
        });

        it('disables TOTP and revokes the existing access/session generation atomically', async () => {
            const secret = await enableTestTotp();
            const token = currentTotpToken(secret);

            await expect(totpService.disableTotp('user-1', token)).resolves.toEqual({ disabled: true });

            expect(mockUser.update).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    settings: expect.objectContaining({
                        totp_secret: null,
                        totp_pending: null,
                        totp_enabled: false,
                    }),
                }),
                { transaction: mockTransaction },
            );
            expect(mockInvalidateUserSessions).toHaveBeenCalledWith('user-1', {
                transaction: mockTransaction,
            });
        });
    });

    describe('TOTP Temp Token', () => {
        it('should save temp token with 5 minute TTL', async () => {
            const userId = 'user-1';
            const tempToken = 'temp-token-123';

            await totpService.saveTempToken(userId, tempToken);

            expect(mockRedis.setex).toHaveBeenCalledWith(
                `totp_temp:${tempToken}`,
                300, // 5 minutes
                userId
            );
        });

        it('should consume and delete temp token', async () => {
            const tempToken = 'temp-token-456';
            const userId = 'user-1';

            // Setup token in Redis
            redisStore[`totp_temp:${tempToken}`] = userId;

            const result = await totpService.consumeTempToken(tempToken);

            expect(result).toBe(userId);
            expect(redisStore[`totp_temp:${tempToken}`]).toBeUndefined();
            await expect(totpService.consumeTempToken(tempToken)).resolves.toBeNull();
        });

        it('hands a temp token to exactly one of two concurrent consumers', async () => {
            const tempToken = 'temp-token-race';
            redisStore[`totp_temp:${tempToken}`] = 'user-1';

            const results = await Promise.all([
                totpService.consumeTempToken(tempToken),
                totpService.consumeTempToken(tempToken),
            ]);

            expect(results.filter((r) => r === 'user-1')).toHaveLength(1);
            expect(results.filter((r) => r === null)).toHaveLength(1);
        });

        it('should return null for invalid temp token', async () => {
            const result = await totpService.consumeTempToken('invalid-token');
            expect(result).toBeNull();
        });
    });
});
