'use strict';

const mockRoleCache = new Map();
const mockUserFindByPk = jest.fn();

jest.mock('../../../config/config', () => ({
    env: 'test',
    growthOsEnabled: true,
}));

jest.mock('../../../config/redis', () => ({
    cacheRedis: { status: 'ready', _isMemoryFallback: false },
}));

jest.mock('../../../utils/cache.service', () => ({
    get: jest.fn(async (key) => mockRoleCache.get(key) ?? null),
    set: jest.fn(async (key, value) => mockRoleCache.set(key, value)),
    getStrict: jest.fn(async (key) => mockRoleCache.get(key) ?? null),
    setStrict: jest.fn(async (key, value) => mockRoleCache.set(key, value)),
}));

jest.mock('../growth-os.repository', () => ({
    findActiveRoleForUser: jest.fn(async () => null),
}));

jest.mock('../../entities', () => ({
    User: { findByPk: mockUserFindByPk },
}));

const { requireGrowthOsAccess } = require('../growth-os.middleware');

function runGuard(user) {
    const next = jest.fn();
    const req = { user };
    return requireGrowthOsAccess()(req, {}, next).then(() => ({ req, next }));
}

describe('Growth OS initial-admin authorization boundary', () => {
    beforeEach(() => {
        mockRoleCache.clear();
        mockUserFindByPk.mockReset();
    });

    test('returns the MFA enrollment boundary without granting Growth access', async () => {
        mockUserFindByPk.mockResolvedValue({
            must_change_password: false,
            settings: { internal_growth_bootstrap: true, totp_enabled: false },
        });

        const { req, next } = await runGuard({ userId: 'bootstrap-user' });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            status: 403,
            code: 'GROWTH_OS_BOOTSTRAP_MFA_REQUIRED',
        }));
        expect(req.growthOs).toBeUndefined();
    });

    test('returns the pending grant boundary after MFA and still denies the workspace', async () => {
        mockUserFindByPk.mockResolvedValue({
            must_change_password: false,
            settings: { internal_growth_bootstrap: true, totp_enabled: true },
        });

        const { req, next } = await runGuard({ userId: 'bootstrap-user', mfaVerified: true });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            status: 403,
            code: 'GROWTH_OS_BOOTSTRAP_PENDING',
        }));
        expect(req.growthOs).toBeUndefined();
    });

    test('keeps ordinary shop-less users on the existing generic denial', async () => {
        mockUserFindByPk.mockResolvedValue({ must_change_password: false, settings: {} });

        const { next } = await runGuard({ userId: 'ordinary-user' });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            status: 403,
            code: 'GROWTH_OS_FORBIDDEN',
        }));
    });
});
