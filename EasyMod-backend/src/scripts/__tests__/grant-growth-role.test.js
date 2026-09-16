'use strict';

jest.mock('../../utils/database/database-setup', () => ({
    sequelize: {
        authenticate: jest.fn(),
        close: jest.fn(),
    },
}));
jest.mock('../../modules/user/user.entity', () => ({
    findOne: jest.fn(),
    findByPk: jest.fn(),
}));
jest.mock('../../modules/growth-os/growth-os.roles.service', () => ({
    grantRole: jest.fn(),
    bootstrapRole: jest.fn(),
    revokeRole: jest.fn(),
}));

const { sequelize } = require('../../utils/database/database-setup');
const User = require('../../modules/user/user.entity');
const roleService = require('../../modules/growth-os/growth-os.roles.service');
const {
    BOOTSTRAP_REASON,
    run,
    USAGE,
} = require('../grant-growth-role');

describe('grant-growth-role CLI', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sequelize.authenticate.mockResolvedValue();
        sequelize.close.mockResolvedValue();
        roleService.bootstrapRole.mockResolvedValue({ id: 'role-1' });
        delete process.env.GROWTH_BOOTSTRAP_ACTOR_EMAIL;
        delete process.env.GITHUB_ACTOR;
    });

    test('rejects a missing email, unknown role, actor flag, or actor configuration before connecting', async () => {
        await expect(run([])).rejects.toThrow(USAGE);
        await expect(run(['founder@example.com', 'NOT_A_ROLE'])).rejects.toThrow(USAGE);
        await expect(run(['founder@example.com', 'FOUNDER'])).rejects.toThrow(USAGE);
        await expect(run(['founder@example.com', 'SUPER_ADMIN', '--actor', 'operator@example.com'])).rejects.toThrow(USAGE);

        expect(sequelize.authenticate).not.toHaveBeenCalled();
    });

    test('uses the configured bootstrap actor and delegates the canonical bootstrap role', async () => {
        process.env.GROWTH_BOOTSTRAP_ACTOR_EMAIL = 'operator@example.com';
        User.findOne
            .mockResolvedValueOnce({ id: 'user-1' })
            .mockResolvedValueOnce({ id: 'operator-1' });

        await run(['founder@example.com', 'SUPER_ADMIN']);

        expect(User.findOne).toHaveBeenNthCalledWith(1, { where: { email: 'founder@example.com' } });
        expect(User.findOne).toHaveBeenNthCalledWith(2, { where: { email: 'operator@example.com' } });
        expect(roleService.bootstrapRole).toHaveBeenCalledWith({
            actorUserId: 'operator-1',
            targetUserId: 'user-1',
            role: 'SUPER_ADMIN',
            reason: BOOTSTRAP_REASON,
        });
        expect(sequelize.close).toHaveBeenCalledTimes(1);
    });

    test('includes the trusted GitHub actor in the bootstrap audit reason', async () => {
        process.env.GROWTH_BOOTSTRAP_ACTOR_EMAIL = 'operator@example.com';
        process.env.GITHUB_ACTOR = 'release-operator';
        User.findOne
            .mockResolvedValueOnce({ id: 'user-1' })
            .mockResolvedValueOnce({ id: 'operator-1' });

        await run(['founder@example.com', 'SUPER_ADMIN']);

        expect(roleService.bootstrapRole).toHaveBeenCalledWith({
            actorUserId: 'operator-1',
            targetUserId: 'user-1',
            role: 'SUPER_ADMIN',
            reason: `${BOOTSTRAP_REASON} (GitHub actor: release-operator)`,
        });
    });
});
