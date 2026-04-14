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
        it('should throw error when APP_SECRET and JWT_SECRET are missing', () => {
            const originalAppSecret = process.env.APP_SECRET;
            const originalJwtSecret = process.env.JWT_SECRET;

            // Clear secrets
            delete process.env.APP_SECRET;
            delete process.env.JWT_SECRET;

            // Should throw when trying to get encryption key
            expect(() => {
                // Force re-require to pick up new env
                jest.resetModules();
                require('src/modules/auth/totp.service');
            }).toThrow();

            // Restore
            process.env.APP_SECRET = originalAppSecret;
            process.env.JWT_SECRET = originalJwtSecret;
        });
    });

    describe('TOTP Token Replay Protection', () => {
        it('should mark TOTP token as used after successful verification', async () => {
            const userId = 'user-1';
            const token = '123456';

            // Setup pending TOTP
            mockUser.settings.totp_pending = null; // Already enabled
            mockUser.settings.totp_enabled = true;
            mockUser.settings.totp_secret = 'JBSWY3DPEHPK3PXP'; // Base32 secret

            // First verification should work
            // Note: We can't actually verify TOTP without real crypto, but we can test the Redis usage marking

            // Check that markTokenUsed was called
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
