'use strict';

const mockVerifyAccessToken = jest.fn();
const mockIsTokenBlacklisted = jest.fn();
const mockUserFindByPk = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();

jest.mock('../../utils/jwt.util', () => ({
    verifyAccessToken: mockVerifyAccessToken,
}));
jest.mock('../../modules/auth/auth.service', () => ({
    isTokenBlacklisted: mockIsTokenBlacklisted,
}));
jest.mock('../../modules/entities', () => ({
    User: { findByPk: mockUserFindByPk },
}));
jest.mock('../../utils/cache.service', () => ({
    get: mockCacheGet,
    set: mockCacheSet,
}));

const { authenticate } = require('../auth.middleware');

function runAuthenticate() {
    const req = {
        headers: { authorization: 'Bearer signed-access-token' },
        cookies: {},
    };
    return new Promise((resolve) => {
        authenticate(req, {}, (error) => resolve({ error, req }));
    });
}

describe('access-token revocation state', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsTokenBlacklisted.mockResolvedValue(false);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
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
    });
});
