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
    status: 'ready'
};

jest.mock('src/utils/redis-client', () => ({
    getRedisClient: () => mockRedis
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

            // totp_secret is stored ENCRYPTED (iv:tag:ciphertext). Assigning a
            // raw base32 string made decryptSecret split on ':' and hand
            // Buffer.from an undefined tag. Take the encrypted form from the
            // service's own setup path instead.
            const { secret } = await totpService.generateTotpSecret(userId);
            mockUser.settings.totp_secret = mockUser.settings.totp_pending;
            mockUser.settings.totp_pending = null;
            mockUser.settings.totp_enabled = true;

            // Marking-as-used only happens after a code actually verifies, so
            // this needs a real one, from the service's own implementation.
            const token = totpService.hotp(secret, Math.floor(Date.now() / 1000 / 30));

            await totpService.verifyTotpToken(userId, token);

            // The implementation should have marked the token as used in Redis
            expect(mockRedis.setex).toHaveBeenCalledWith(
                expect.stringContaining('totp_used:'),
                expect.any(Number),
                '1'
            );
        });

        it('should reject reused TOTP tokens', async () => {
            const userId = 'user-1';
            const token = '123456';

            mockUser.settings.totp_enabled = true;
            mockUser.settings.totp_secret = 'JBSWY3DPEHPK3PXP';

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
            expect(mockRedis.del).toHaveBeenCalledWith(`totp_temp:${tempToken}`);
        });

        it('should return null for invalid temp token', async () => {
            const result = await totpService.consumeTempToken('invalid-token');
            expect(result).toBeNull();
        });
    });
});
