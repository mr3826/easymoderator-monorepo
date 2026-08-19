'use strict';

const roleHolder = {
  user: null,
  growthRole: null,
  frontendGuardClaim: null,
};

const mockConfig = {
  growthOsEnabled: true,
};

jest.mock('../../../config/config', () => mockConfig);

jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => {
    if (!roleHolder.user) {
      const err = new Error('No token provided. Please authenticate.');
      err.status = 401;
      return next(err);
    }
    req.user = roleHolder.user;
    if (roleHolder.frontendGuardClaim) {
      req.headers['x-frontend-guard-claim'] = roleHolder.frontendGuardClaim;
    }
    return next();
  },
}));

jest.mock('../../../utils/cache.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
}));

jest.mock('../../entities', () => ({
  GrowthOsUserRole: {
    findAll: jest.fn(async () => (
      roleHolder.growthRole
        ? [{ role: roleHolder.growthRole, user_id: roleHolder.user?.userId, id: 'role-1', granted_at: new Date() }]
        : []
    )),
  },
  User: {
    findByPk: jest.fn(async (id) => ({
      id,
      full_name: id === 'founder-1' ? 'Founder User' : 'Executive User',
      email: `${id}@easymod.tech`,
    })),
  },
}));

const express = require('express');
const request = require('supertest');
const growthOsRoutes = require('../growth-os.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/growth-os', growthOsRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message, code: err.code });
  });
  return app;
}

describe('Growth OS session authorization', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    mockConfig.growthOsEnabled = true;
    roleHolder.user = null;
    roleHolder.growthRole = null;
    roleHolder.frontendGuardClaim = null;
  });

  it('denies unauthenticated requests', async () => {
    const res = await request(app).get('/api/internal/growth-os/session');
    expect(res.status).toBe(401);
  });

  it('fails closed without consulting the authorization store when Growth OS is disabled', async () => {
    const cacheService = require('../../../utils/cache.service');
    const { GrowthOsUserRole } = require('../../entities');
    roleHolder.user = { userId: 'founder-1', email: 'founder@easymod.tech' };
    roleHolder.growthRole = 'FOUNDER';
    mockConfig.growthOsEnabled = false;

    const res = await request(app).get('/api/internal/growth-os/session');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('GROWTH_OS_DISABLED');
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(GrowthOsUserRole.findAll).not.toHaveBeenCalled();
  });

  it('denies a merchant user with no explicit Growth OS role', async () => {
    roleHolder.user = { userId: 'merchant-owner-1', email: 'owner@example.com', shopId: 'shop-1' };
    const res = await request(app).get('/api/internal/growth-os/session');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GROWTH_OS_FORBIDDEN');
  });

  it('denies an internal/platform user without explicit Growth OS access', async () => {
    roleHolder.user = { userId: 'platform-admin-1', email: 'admin@easymod.tech' };
    const res = await request(app).get('/api/internal/growth-os/session');
    expect(res.status).toBe(403);
  });

  it('returns a controlled 503 when the authorization store is unavailable', async () => {
    const { GrowthOsUserRole } = require('../../entities');
    roleHolder.user = { userId: 'founder-1', email: 'founder@easymod.tech' };
    GrowthOsUserRole.findAll.mockRejectedValueOnce(new Error('database connection details'));

    const res = await request(app).get('/api/internal/growth-os/session');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'GROWTH_OS_AUTHZ_UNAVAILABLE',
      message: 'Growth OS authorization service is temporarily unavailable.',
    });
    expect(res.body.message).not.toContain('database connection details');
  });

  it('allows an authorized founder and returns safe session fields', async () => {
    roleHolder.user = { userId: 'founder-1', email: 'founder@easymod.tech' };
    roleHolder.growthRole = 'FOUNDER';

    const res = await request(app).get('/api/internal/growth-os/session');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      internalUserId: 'founder-1',
      displayName: 'Founder User',
      role: 'FOUNDER',
    });
    expect(res.body.data.permissions).toContain('growth_os.roles.manage');
    expect(res.body.data).not.toHaveProperty('token');
    expect(res.body.data).not.toHaveProperty('password');
  });

  it('allows an authorized executive with limited permissions', async () => {
    roleHolder.user = { userId: 'executive-1', email: 'exec@easymod.tech' };
    roleHolder.growthRole = 'BUSINESS_EXECUTIVE';

    const res = await request(app).get('/api/internal/growth-os/session');

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('BUSINESS_EXECUTIVE');
    expect(res.body.data.permissions).toContain('growth_os.prospects.read_assigned');
    expect(res.body.data.permissions).not.toContain('growth_os.roles.manage');
    expect(res.body.data.permissions).not.toContain('growth_os.prospects.read_all');
  });

  it('does not trust a frontend route guard claim without backend access', async () => {
    roleHolder.user = { userId: 'merchant-owner-1', email: 'owner@example.com', shopId: 'shop-1' };
    roleHolder.frontendGuardClaim = 'allowed';

    const res = await request(app).get('/api/internal/growth-os/session');

    expect(res.status).toBe(403);
  });
});
