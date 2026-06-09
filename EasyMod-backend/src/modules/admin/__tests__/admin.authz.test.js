'use strict';

/**
 * Router-level authorization tests for the admin panel.
 *
 * Mounts ONLY admin.routes on a minimal Express app — no full app boot, no Redis
 * (the repo excludes *.api.integration.test.js for exactly that reason). The real
 * requirePlatformAdmin guard runs; auth/entities/cache and the service layer are mocked.
 */

const platformRoleHolder = { value: null };

// Inject a fixed authenticated user; role is varied via the entities mock below.
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { userId: 'admin-1', email: 'a@x.io' }; next(); },
  checkSubscriptionStatus: (_req, _res, next) => next(),
}));

// The guard reads users.platform_role; force a cache miss so it hits the (mocked) DB.
jest.mock('../../../utils/cache.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  deleteForShop: jest.fn(async () => {}),
}));
jest.mock('../../entities', () => ({
  User: { findByPk: jest.fn(async () => ({ platform_role: platformRoleHolder.value })) },
}));

// Service + audit are exercised elsewhere; here we only care about authorization.
jest.mock('../admin.service', () => ({
  getDashboard: jest.fn(async () => ({ ok: true })),
  setShopStatus: jest.fn(async () => ({ before: { status: 'active' }, after: { status: 'suspended' } })),
}));
jest.mock('../../audit/audit.service', () => ({ logOperation: jest.fn(async () => {}) }));

const express = require('express');
const request = require('supertest');
const adminRoutes = require('../admin.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  // Minimal error handler mapping AppError.status → HTTP status.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe('admin authorization (router-level)', () => {
  let app;
  beforeEach(() => { app = buildApp(); platformRoleHolder.value = null; });

  it('403 for a normal user (no platform_role) on a read route', async () => {
    platformRoleHolder.value = null;
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(403);
  });

  it('200 for SUPPORT_ADMIN on a read route', async () => {
    platformRoleHolder.value = 'SUPPORT_ADMIN';
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('403 for SUPPORT_ADMIN on a mutation', async () => {
    platformRoleHolder.value = 'SUPPORT_ADMIN';
    const res = await request(app).patch('/api/admin/shops/shop-1/status').send({ status: 'suspended' });
    expect(res.status).toBe(403);
  });

  it('200 for SUPER_ADMIN on a mutation (reaches the handler + audited)', async () => {
    platformRoleHolder.value = 'SUPER_ADMIN';
    const res = await request(app).patch('/api/admin/shops/shop-1/status').send({ status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'suspended' });
  });
});
