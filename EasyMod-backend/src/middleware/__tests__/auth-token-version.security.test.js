'use strict';

const mockVerifyAccessToken = jest.fn();
const mockIsTokenBlacklisted = jest.fn();
const mockUserFindByPk = jest.fn();
const mockUserShopFindOne = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockCacheGetForShop = jest.fn();
const mockCacheSetForShop = jest.fn();
const mockSubscriptionFindOne = jest.fn();

jest.mock('../../utils/jwt.util', () => ({
    verifyAccessToken: mockVerifyAccessToken,
}));
jest.mock('../../modules/auth/auth.service', () => ({
    isTokenBlacklisted: mockIsTokenBlacklisted,
}));
jest.mock('../../modules/entities', () => ({
    User: { findByPk: mockUserFindByPk },
    Shop: {},
    UserShop: { findOne: mockUserShopFindOne },
    Subscription: { findOne: mockSubscriptionFindOne },
}));
jest.mock('../../utils/cache.service', () => ({
    get: mockCacheGet,
    set: mockCacheSet,
    getForShop: mockCacheGetForShop,
    setForShop: mockCacheSetForShop,
}));

const { authenticate, checkSubscriptionStatus } = require('../auth.middleware');

function runAuthenticate(options) {
    const req = {
        headers: { authorization: 'Bearer signed-access-token' },
        cookies: {},
    };
    return new Promise((resolve) => {
        const middleware = options ? authenticate(options) : authenticate;
        middleware(req, {}, (error) => resolve({ error, req }));
    });
}

describe('access-token revocation state', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsTokenBlacklisted.mockResolvedValue(false);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCacheGetForShop.mockResolvedValue(null);
        mockCacheSetForShop.mockResolvedValue(undefined);
        mockUserShopFindOne.mockResolvedValue({
            user_id: 'user-1',
            shop_id: 'shop-1',
            role: 'owner',
            is_active: true,
            shop: { id: 'shop-1', is_active: true },
        });
    });

    test('rejects a signed token that omits tokenVersion instead of bypassing revocation', async () => {
        mockVerifyAccessToken.mockReturnValue({
            userId: 'user-1',
            shopId: 'shop-1',
            email: 'owner@example.test',
        });

        const { error } = await runAuthenticate();

        expect(error).toMatchObject({ status: 401 });
        expect(error.message).toMatch(/revocation state/);
        expect(mockUserFindByPk).not.toHaveBeenCalled();
    });

    test('validates tokenVersion zero rather than treating it as absent', async () => {
        mockVerifyAccessToken.mockReturnValue({
            userId: 'user-1',
            shopId: 'shop-1',
            email: 'owner@example.test',
            tokenVersion: 0,
            exp: 123,
        });
        mockUserFindByPk.mockResolvedValue({ token_version: 0 });

        const { error, req } = await runAuthenticate();

        expect(error).toBeUndefined();
        expect(mockUserFindByPk).toHaveBeenCalledWith('user-1', {
            attributes: ['token_version'],
        });
        expect(req.user).toMatchObject({ userId: 'user-1', shopId: 'shop-1' });
        expect(req.user.mfaVerified).toBe(false);
    });

    test('rejects a signed token after its shop membership is deactivated', async () => {
        mockVerifyAccessToken.mockReturnValue({
            userId: 'user-1',
            shopId: 'shop-1',
            email: 'owner@example.test',
            tokenVersion: 0,
            exp: 123,
        });
        mockUserFindByPk.mockResolvedValue({ token_version: 0 });
        mockUserShopFindOne.mockResolvedValue(null);

        const { error } = await runAuthenticate();

        expect(error).toMatchObject({ status: 401 });
        expect(error.message).toMatch(/membership is inactive/);
    });

    test('allows explicitly opted-out recovery middleware to run without shop membership', async () => {
        mockVerifyAccessToken.mockReturnValue({
            userId: 'user-1',
            shopId: 'shop-1',
            email: 'owner@example.test',
            tokenVersion: 0,
            exp: 123,
        });
        mockUserFindByPk.mockResolvedValue({ token_version: 0 });
        mockUserShopFindOne.mockResolvedValue(null);

        const { error, req } = await runAuthenticate({ requireShopMembership: false });

        expect(error).toBeUndefined();
        expect(req.user).toMatchObject({ userId: 'user-1', shopId: 'shop-1' });
        expect(req.activeMembership).toBeNull();
    });

    test('propagates the server-issued MFA assurance claim', async () => {
        mockVerifyAccessToken.mockReturnValue({
            userId: 'user-1',
            shopId: 'shop-1',
            email: 'operator@example.test',
            tokenVersion: 0,
            mfaVerified: true,
            exp: 123,
        });
        mockUserFindByPk.mockResolvedValue({ token_version: 0 });

        const { error, req } = await runAuthenticate();

        expect(error).toBeUndefined();
        expect(req.user.mfaVerified).toBe(true);
    });

    test('returns a temporary authentication failure when the revocation store is unavailable', async () => {
        mockVerifyAccessToken.mockReturnValue({
            userId: 'user-1',
            shopId: 'shop-1',
            email: 'operator@example.test',
            tokenVersion: 0,
            exp: 123,
        });
        mockIsTokenBlacklisted.mockRejectedValue(new Error('redis unavailable'));

        const { error } = await runAuthenticate();

        expect(error).toMatchObject({ status: 503, code: 'AUTH_SERVICE_UNAVAILABLE' });
        expect(error.message).not.toContain('redis unavailable');
    });

    test('fails closed when subscription state cannot be read', async () => {
        mockCacheGetForShop.mockRejectedValue(new Error('redis unavailable'));

        const result = await new Promise((resolve) => {
            checkSubscriptionStatus(
                { user: { shopId: 'shop-1' } },
                {},
                (error) => resolve({ error }),
            );
        });

        expect(result.error).toMatchObject({ status: 503 });
        expect(result.error.message).toMatch(/temporarily unavailable/);
    });
});
