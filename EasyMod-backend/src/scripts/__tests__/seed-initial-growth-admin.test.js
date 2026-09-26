'use strict';

const { QueryTypes } = require('sequelize');

jest.mock('../../utils/database/database-setup', () => ({
    sequelize: {
        getDialect: jest.fn(() => 'postgres'),
        query: jest.fn(),
        authenticate: jest.fn(),
        close: jest.fn(),
        transaction: jest.fn(),
    },
}));

jest.mock('../../modules/entities', () => ({
    User: {
        findOne: jest.fn(),
        create: jest.fn(),
    },
    GrowthOsUserRole: {
        findOne: jest.fn(),
    },
}));

jest.mock('../../utils/password.util', () => ({
    hashPassword: jest.fn(async () => 'bcrypt-hash-only'),
}));

jest.mock('../../modules/auth/temporary-password', () => ({
    getTemporaryPasswordExpiry: jest.fn(() => new Date('2026-09-26T12:00:00.000Z')),
}));

jest.mock('../../modules/audit/audit.service', () => ({
    logOperation: jest.fn(),
}));

jest.mock('../../modules/growth-os/growth-os.roles.service', () => ({
    SUPER_ADMIN_ROLE_VALUES: ['SUPER_ADMIN', 'FOUNDER'],
}));

const { sequelize } = require('../../utils/database/database-setup');
const { User, GrowthOsUserRole } = require('../../modules/entities');
const { hashPassword } = require('../../utils/password.util');
const AuditService = require('../../modules/audit/audit.service');
const {
    BOOTSTRAP_AUDIT_ACTION,
    BOOTSTRAP_AUDIT_RESOURCE,
    BOOTSTRAP_LOCK_KEY,
    DEFAULT_EMAIL,
    run,
} = require('../seed-initial-growth-admin');

const transaction = { LOCK: { UPDATE: 'UPDATE' } };

describe('seed-initial-growth-admin', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NODE_ENV = 'production';
        process.env.INITIAL_GROWTH_ADMIN_EMAIL = DEFAULT_EMAIL;
        process.env.INITIAL_GROWTH_ADMIN_PASSWORD = 'Unit-Only-Seed-Password-9!';
        process.env.GITHUB_ACTOR = 'release-operator';

        sequelize.authenticate.mockResolvedValue();
        sequelize.close.mockResolvedValue();
        sequelize.transaction.mockImplementation(async (callback) => callback(transaction));
        sequelize.query.mockImplementation(async (_sql, options = {}) => (
            options.type === QueryTypes.SELECT ? [] : []
        ));
        GrowthOsUserRole.findOne.mockResolvedValue(null);
        User.findOne.mockResolvedValue(null);
        User.create.mockResolvedValue({
            id: 'seeded-user-id',
            email: DEFAULT_EMAIL,
            full_name: 'Growth Administrator',
        });
        AuditService.logOperation.mockResolvedValue();
    });

    afterEach(() => {
        delete process.env.INITIAL_GROWTH_ADMIN_EMAIL;
        delete process.env.INITIAL_GROWTH_ADMIN_PASSWORD;
        delete process.env.GITHUB_ACTOR;
    });

    test('creates a shop-less temporary-password identity without granting a role', async () => {
        const result = await run();

        expect(result).toMatchObject({
            userId: 'seeded-user-id',
            email: DEFAULT_EMAIL,
            passwordChangeRequired: true,
        });
        expect(sequelize.query).toHaveBeenCalledWith(
            'SELECT pg_advisory_xact_lock(hashtext(:lockKey))',
            expect.objectContaining({
                replacements: { lockKey: BOOTSTRAP_LOCK_KEY },
                transaction,
            }),
        );
        expect(sequelize.query.mock.calls[1][0]).toContain('CAST(settings AS jsonb)');
        expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
            email: DEFAULT_EMAIL,
            password: 'bcrypt-hash-only',
            full_name: 'Growth Administrator',
            is_active: true,
            is_verified: true,
            must_change_password: true,
            settings: { internal_growth_bootstrap: true },
        }), expect.objectContaining({ transaction }));
        expect(hashPassword).toHaveBeenCalledWith('Unit-Only-Seed-Password-9!');
        expect(AuditService.logOperation).toHaveBeenCalledWith(expect.objectContaining({
            action: BOOTSTRAP_AUDIT_ACTION,
            resourceType: BOOTSTRAP_AUDIT_RESOURCE,
            resourceId: 'seeded-user-id',
            newValues: expect.objectContaining({
                email: DEFAULT_EMAIL,
                password_change_required: true,
            }),
            metadata: expect.objectContaining({ github_actor: 'release-operator' }),
        }), expect.objectContaining({ transaction, required: true }));
        expect(JSON.stringify(AuditService.logOperation.mock.calls[0])).not.toContain('Unit-Only-Seed-Password-9!');
    });

    test('refuses to seed when an active Super Admin already exists', async () => {
        GrowthOsUserRole.findOne.mockResolvedValue({ id: 'existing-super-admin' });

        await expect(run()).rejects.toMatchObject({ exitCode: 3 });

        expect(User.create).not.toHaveBeenCalled();
        expect(hashPassword).not.toHaveBeenCalled();
    });

    test('refuses to seed when another pending bootstrap identity exists', async () => {
        sequelize.query
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: 'pending-user', email: 'pending@example.test' }]);

        await expect(run()).rejects.toMatchObject({ exitCode: 3 });

        expect(User.create).not.toHaveBeenCalled();
        expect(User.findOne).not.toHaveBeenCalled();
    });

    test('refuses to overwrite an existing email', async () => {
        User.findOne.mockResolvedValue({ id: 'existing-user' });

        await expect(run()).rejects.toMatchObject({ exitCode: 3 });

        expect(User.create).not.toHaveBeenCalled();
        expect(hashPassword).not.toHaveBeenCalled();
    });

    test('requires the protected password input and refuses non-production execution', async () => {
        delete process.env.INITIAL_GROWTH_ADMIN_PASSWORD;
        await expect(run()).rejects.toMatchObject({ exitCode: 2 });

        process.env.INITIAL_GROWTH_ADMIN_PASSWORD = 'Unit-Only-Seed-Password-9!';
        process.env.NODE_ENV = 'test';
        await expect(run()).rejects.toMatchObject({ exitCode: 2 });
        process.env.NODE_ENV = 'development';
        await expect(run()).rejects.toMatchObject({ exitCode: 2 });
        expect(sequelize.authenticate).not.toHaveBeenCalled();
    });
});
