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
        await expect(run(['founder@example.com', 'FOUNDER'])).rejects.toThrow(USAGE);

        expect(sequelize.authenticate).not.toHaveBeenCalled();
    });

    test('delegates a grant with the explicit operator as the audit actor', async () => {
        User.findOne
            .mockResolvedValueOnce({ id: 'user-1' })
            .mockResolvedValueOnce({ id: 'operator-1' });

        await run(['founder@example.com', 'FOUNDER', '--actor', 'operator@example.com']);

        expect(User.findOne).toHaveBeenNthCalledWith(1, { where: { email: 'founder@example.com' } });
        expect(User.findOne).toHaveBeenNthCalledWith(2, { where: { email: 'operator@example.com' } });
        expect(roleService.grantRole).toHaveBeenCalledWith({
            actorUserId: 'operator-1',
            targetUserId: 'user-1',
            role: 'FOUNDER',
            reason: BOOTSTRAP_REASON,
        });
        expect(roleService.revokeRole).not.toHaveBeenCalled();
        expect(sequelize.close).toHaveBeenCalledTimes(1);
    });

    test('resolves a UUID actor and delegates revocation', async () => {
        User.findOne.mockResolvedValueOnce({ id: 'user-1' });
        User.findByPk.mockResolvedValueOnce({ id: 'operator-1' });

        await run([
            'founder@example.com',
            'NONE',
            '--actor',
            '11111111-1111-4111-8111-111111111111',
        ]);

        expect(User.findByPk).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
        expect(roleService.revokeRole).toHaveBeenCalledWith({
            actorUserId: 'operator-1',
            targetUserId: 'user-1',
            reason: BOOTSTRAP_REASON,
        });
    });
});
