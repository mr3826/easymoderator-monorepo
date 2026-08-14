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
        it('should throw error when TOTP encryption secrets are missing', async () => {
            const originalAppSecret = process.env.APP_SECRET;
            const originalJwtSecret = process.env.JWT_SECRET;

            // Clear secrets
            delete process.env.APP_SECRET;
            delete process.env.JWT_SECRET;

            await expect(totpService.generateTotpSecret('user-1'))
                .rejects
                .toThrow(/APP_SECRET, JWT_SECRET, or JWT_ACCESS_SECRET/);

            // Restore
            process.env.APP_SECRET = originalAppSecret;
            process.env.JWT_SECRET = originalJwtSecret;
        });
    });

    describe('TOTP Token Replay Protection', () => {
        it('should mark TOTP token as used after successful verification', async () => {
            const userId = 'user-1';
            const secret = await enableTestTotp(userId);
            const token = currentTotpToken(secret);

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
