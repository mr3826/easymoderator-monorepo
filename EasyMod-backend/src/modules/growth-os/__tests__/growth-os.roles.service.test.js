'use strict';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockInactiveRole = {
  id: 'role-1',
  user_id: TARGET_ID,
  role: 'GROWTH_USER',
  is_active: false,
  revoked_at: null,
  update: jest.fn(),
};

jest.mock('../../entities', () => ({
  User: { findByPk: jest.fn() },
  UserShop: { findOne: jest.fn() },
  GrowthOsUserRole: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
  },
  AuditLog: { create: jest.fn() },
}));

jest.mock('../../../utils/database/database-setup', () => ({
  sequelize: {
    transaction: jest.fn(async (callback) => callback(mockTransaction)),
  },
}));

jest.mock('../../../utils/cache.service', () => ({
  delete: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../auth/session-invalidation.service', () => ({
  invalidateUserSessions: jest.fn().mockResolvedValue(1),
}));

const { User, UserShop, GrowthOsUserRole } = require('../../entities');
const roles = require('../growth-os.roles.service');

describe('Growth OS role and merchant membership boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findByPk.mockResolvedValue({ id: TARGET_ID });
    UserShop.findOne.mockResolvedValue(null);
  });

  it('does not reactivate a Growth role while an active merchant membership exists', async () => {
    GrowthOsUserRole.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockInactiveRole);
    UserShop.findOne.mockResolvedValueOnce({ id: 'membership-1', is_active: true });

    await expect(roles.setActiveStatus({
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      active: true,
      reason: 'Boundary regression',
    })).rejects.toMatchObject({
      status: 409,
      code: 'GROWTH_OS_MERCHANT_ROLE_CONFLICT',
    });

    expect(mockInactiveRole.update).not.toHaveBeenCalled();
  });
});
