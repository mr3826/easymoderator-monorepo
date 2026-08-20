'use strict';

jest.mock('../../utils/database/database-setup', () => ({
    sequelize: {
        authenticate: jest.fn(),
        close: jest.fn(),
    },
}));
jest.mock('../../modules/user/user.entity', () => ({
    findOne: jest.fn(),
}));
jest.mock('../../modules/growth-os/growth-os.roles.service', () => ({
    grantRole: jest.fn(),
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
        roleService.grantRole.mockResolvedValue({ id: 'role-1' });
        roleService.revokeRole.mockResolvedValue({ id: 'role-1' });
    });

    test('rejects a missing email or unknown role before connecting', async () => {
        await expect(run([])).rejects.toThrow(USAGE);
        await expect(run(['founder@example.com', 'NOT_A_ROLE'])).rejects.toThrow(USAGE);

        expect(sequelize.authenticate).not.toHaveBeenCalled();
    });

    test('delegates a grant to the role service as a bootstrap self-grant', async () => {
        User.findOne.mockResolvedValue({ id: 'user-1' });

        await run(['founder@example.com', 'FOUNDER']);

        expect(User.findOne).toHaveBeenCalledWith({ where: { email: 'founder@example.com' } });
        expect(roleService.grantRole).toHaveBeenCalledWith({
            actorUserId: 'user-1',
            targetUserId: 'user-1',
            role: 'FOUNDER',
            reason: BOOTSTRAP_REASON,
        });
        expect(roleService.revokeRole).not.toHaveBeenCalled();
        expect(sequelize.close).toHaveBeenCalledTimes(1);
    });
});
