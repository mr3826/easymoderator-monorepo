'use strict';

jest.mock('../../utils/database/database-setup', () => ({
    sequelize: {
        authenticate: jest.fn(),
        close: jest.fn(),
        transaction: jest.fn(),
        query: jest.fn(),
    },
}));
jest.mock('../../modules/user/user.entity', () => ({
    findOne: jest.fn(),
}));
jest.mock('../../utils/cache.service', () => ({
    set: jest.fn(),
    setStrict: jest.fn(),
}));
jest.mock('../../modules/audit/audit.service', () => ({
    logOperation: jest.fn(),
}));
jest.mock('../../modules/auth/session-invalidation.service', () => ({
    invalidateUserSessions: jest.fn(),
}));
jest.mock('../../config/redis', () => ({
    closeAllRedis: jest.fn(),
}));

const { sequelize } = require('../../utils/database/database-setup');
const User = require('../../modules/user/user.entity');
const cacheService = require('../../utils/cache.service');
const AuditService = require('../../modules/audit/audit.service');
const { invalidateUserSessions } = require('../../modules/auth/session-invalidation.service');
const { closeAllRedis } = require('../../config/redis');
const {
    AUDIT_ACTION,
    AUDIT_RESOURCE_TYPE,
    USAGE,
    run,
} = require('../grant-platform-admin');

const transaction = { LOCK: { UPDATE: 'UPDATE' } };

describe('grant-platform-admin CLI', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sequelize.authenticate.mockResolvedValue();
        sequelize.close.mockResolvedValue();
        sequelize.query.mockResolvedValue();
        sequelize.transaction.mockImplementation((handler) => handler(transaction));
        closeAllRedis.mockResolvedValue();
        AuditService.logOperation.mockResolvedValue();
        invalidateUserSessions.mockResolvedValue(2);
        cacheService.setStrict.mockResolvedValue(true);
        delete process.env.GITHUB_ACTOR;
    });

    test('rejects malformed invocation before connecting', async () => {
        await expect(run([])).rejects.toThrow(USAGE);
        await expect(run(['ops@example.test', 'ADMIN'])).rejects.toThrow(USAGE);
        expect(sequelize.authenticate).not.toHaveBeenCalled();
    });

    test('audits, invalidates sessions, and re-confirms cache on a real change', async () => {
        process.env.GITHUB_ACTOR = 'mr3826';
        const user = {
            id: 'user-9',
            platform_role: 'SUPPORT_ADMIN',
            update: jest.fn().mockResolvedValue(true),
        };
        User.findOne.mockResolvedValue(user);

        const result = await run(['ops@example.test', 'NONE']);

        expect(user.update).toHaveBeenCalledWith({ platform_role: null }, { transaction });
        expect(AuditService.logOperation).toHaveBeenCalledWith(
            expect.objectContaining({
                action: AUDIT_ACTION,
                resourceType: AUDIT_RESOURCE_TYPE,
                resourceId: 'user-9',
                oldValues: { platform_role: 'SUPPORT_ADMIN' },
                newValues: { platform_role: null },
                metadata: expect.objectContaining({ github_actor: 'mr3826' }),
            }),
            { transaction, required: true },
        );
        expect(invalidateUserSessions).toHaveBeenCalledWith('user-9', { transaction });
        expect(cacheService.setStrict).toHaveBeenCalledWith('user:user-9:platform_role', 'NONE', 60);
        expect(result).toEqual({ noop: false, email: 'ops@example.test', userId: 'user-9', role: null });
        expect(sequelize.close).toHaveBeenCalledTimes(1);
        expect(closeAllRedis).toHaveBeenCalledTimes(1);
    });

    test('no-op changes do not audit, invalidate, or rewrite caches', async () => {
        User.findOne.mockResolvedValue({ id: 'user-9', platform_role: 'SUPER_ADMIN' });

        const result = await run(['ops@example.test', 'SUPER_ADMIN']);

        expect(result.noop).toBe(true);
        expect(AuditService.logOperation).not.toHaveBeenCalled();
        expect(invalidateUserSessions).not.toHaveBeenCalled();
        expect(cacheService.setStrict).not.toHaveBeenCalled();
    });

    test('missing users fail with exit code 2 after cleanup', async () => {
        User.findOne.mockResolvedValue(null);

        await expect(run(['ghost@example.test', 'NONE'])).rejects.toMatchObject({ exitCode: 2 });
        expect(AuditService.logOperation).not.toHaveBeenCalled();
        expect(closeAllRedis).toHaveBeenCalledTimes(1);
    });

    test('an unconfirmed cache re-confirmation exits with a loud code', async () => {
        cacheService.setStrict.mockResolvedValue(false);
        User.findOne.mockResolvedValue({
            id: 'user-9',
            platform_role: 'SUPER_ADMIN',
            update: jest.fn().mockResolvedValue(true),
        });

        await expect(run(['ops@example.test', 'NONE'])).rejects.toMatchObject({ exitCode: 4 });
    });
});
