'use strict';

jest.mock('../../utils/cache.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
}));
jest.mock('../../modules/entities', () => ({
  User: { findByPk: jest.fn() },
}));

const cacheService = require('../../utils/cache.service');
const { User } = require('../../modules/entities');
const { requirePlatformAdmin, PLATFORM_ROLES } = require('../platform-admin.middleware');

function mockRes() {
  return {};
}

describe('requirePlatformAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.get.mockResolvedValue(null);
  });

  it('rejects when no req.user', async () => {
    const next = jest.fn();
    await requirePlatformAdmin()({}, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it('rejects a normal user (platform_role NULL) with 403', async () => {
    User.findByPk.mockResolvedValue({ platform_role: null });
    const next = jest.fn();
    await requirePlatformAdmin()({ user: { userId: 'u1' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });

  it('allows SUPPORT_ADMIN for read routes (default allowed roles)', async () => {
    User.findByPk.mockResolvedValue({ platform_role: 'SUPPORT_ADMIN' });
    const req = { user: { userId: 'u1' } };
    const next = jest.fn();
    await requirePlatformAdmin()(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(req.platformRole).toBe('SUPPORT_ADMIN');
  });

  it('blocks SUPPORT_ADMIN when SUPER_ADMIN required (mutations)', async () => {
    User.findByPk.mockResolvedValue({ platform_role: 'SUPPORT_ADMIN' });
    const next = jest.fn();
    await requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN)({ user: { userId: 'u1' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });

  it('allows SUPER_ADMIN for mutations', async () => {
    User.findByPk.mockResolvedValue({ platform_role: 'SUPER_ADMIN' });
    const req = { user: { userId: 'u1' } };
    const next = jest.fn();
    await requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN)(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('uses cached role and skips DB when cache hit', async () => {
    cacheService.get.mockResolvedValue('SUPER_ADMIN');
    const req = { user: { userId: 'u1' } };
    const next = jest.fn();
    await requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN)(req, mockRes(), next);
    expect(User.findByPk).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('treats cached NONE sentinel as no-access', async () => {
    cacheService.get.mockResolvedValue('NONE');
    const next = jest.fn();
    await requirePlatformAdmin()({ user: { userId: 'u1' } }, mockRes(), next);
    expect(User.findByPk).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});
